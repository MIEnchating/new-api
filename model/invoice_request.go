package model

import (
	"math"
	"net/mail"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const (
	InvoiceRequestPending   = "pending"
	InvoiceRequestIssued    = "issued"
	InvoiceRequestRejected  = "rejected"
	InvoiceRequestWithdrawn = "withdrawn"
)

var (
	ErrInvoiceRequestInput     = common.NewMessage("Invalid invoice application details")
	ErrInvoiceRequestOrders    = common.NewMessage("Select 1 to 100 eligible paid orders belonging to your account")
	ErrInvoiceRequestConflict  = common.NewMessage("An order already has a pending invoice application")
	ErrInvoiceRequestProcessed = common.NewMessage("Invoice application not found or already processed")
)

type InvoiceRequest struct {
	Id             int                   `json:"id"`
	UserId         int                   `json:"user_id" gorm:"index"`
	TitleType      string                `json:"title_type" gorm:"type:varchar(16)"`
	Title          string                `json:"title" gorm:"type:varchar(200)"`
	TaxId          string                `json:"tax_id" gorm:"type:varchar(32)"`
	Email          string                `json:"email" gorm:"type:varchar(254)"`
	InvoiceAddress string                `json:"invoice_address" gorm:"type:varchar(300)"`
	InvoicePhone   string                `json:"invoice_phone" gorm:"type:varchar(50)"`
	BankName       string                `json:"bank_name" gorm:"type:varchar(100)"`
	BankAccount    string                `json:"bank_account" gorm:"type:varchar(64)"`
	Remark         string                `json:"remark" gorm:"type:text"`
	Status         string                `json:"status" gorm:"type:varchar(16);index"`
	CreatedAt      int64                 `json:"created_at" gorm:"autoCreateTime:false"`
	ProcessedAt    int64                 `json:"processed_at"`
	ProcessedBy    int                   `json:"processed_by"`
	InvoiceNumber  string                `json:"invoice_number" gorm:"type:varchar(100)"`
	InvoiceURL     string                `json:"invoice_url" gorm:"type:text"`
	ProcessNote    string                `json:"process_note" gorm:"type:text"`
	Orders         []InvoiceRequestOrder `json:"orders" gorm:"foreignKey:RequestId"`
	Username       string                `json:"username,omitempty" gorm:"-"`
	DisplayName    string                `json:"display_name,omitempty" gorm:"-"`
	EmailSentAt    int64                 `json:"email_sent_at" gorm:"-"`
}

// ActiveTopUpId is populated only while pending. Its nullable unique index
// prevents concurrent applications on every supported database, including SQLite.
// Historical order snapshots remain after rejection or completion.
type InvoiceRequestOrder struct {
	Id            int     `json:"id"`
	RequestId     int     `json:"request_id" gorm:"index;not null"`
	TopUpId       int     `json:"topup_id" gorm:"index;not null"`
	ActiveTopUpId *int    `json:"-" gorm:"uniqueIndex"`
	TradeNo       string  `json:"trade_no" gorm:"type:varchar(255)"`
	Money         float64 `json:"money"`
}

type InvoiceApplicationInput struct {
	OrderIds       []int  `json:"order_ids"`
	TitleType      string `json:"title_type"`
	Title          string `json:"title"`
	TaxId          string `json:"tax_id"`
	Email          string `json:"email"`
	InvoiceAddress string `json:"invoice_address"`
	InvoicePhone   string `json:"invoice_phone"`
	BankName       string `json:"bank_name"`
	BankAccount    string `json:"bank_account"`
	Remark         string `json:"remark"`
}

func CreateInvoiceRequest(userId int, input InvoiceApplicationInput) (*InvoiceRequest, error) {
	input.Title = strings.TrimSpace(input.Title)
	input.TaxId = strings.TrimSpace(input.TaxId)
	input.Email = strings.TrimSpace(input.Email)
	input.InvoiceAddress = strings.TrimSpace(input.InvoiceAddress)
	input.InvoicePhone = strings.TrimSpace(input.InvoicePhone)
	input.BankName = strings.TrimSpace(input.BankName)
	input.BankAccount = strings.TrimSpace(input.BankAccount)
	input.Remark = strings.TrimSpace(input.Remark)
	address, err := mail.ParseAddress(input.Email)
	if err != nil || address.Address != input.Email || len(input.Email) > 254 || input.Title == "" || utf8.RuneCountInString(input.Title) > 200 || len(input.TaxId) > 32 || utf8.RuneCountInString(input.InvoiceAddress) > 300 || utf8.RuneCountInString(input.InvoicePhone) > 50 || utf8.RuneCountInString(input.BankName) > 100 || utf8.RuneCountInString(input.BankAccount) > 64 || utf8.RuneCountInString(input.Remark) > 1000 {
		return nil, ErrInvoiceRequestInput
	}
	if input.TitleType == "" {
		input.TitleType = "company"
	}
	if input.TitleType != "company" || input.TaxId == "" {
		return nil, ErrInvoiceRequestInput
	}
	if userId <= 0 || len(input.OrderIds) == 0 || len(input.OrderIds) > 100 {
		return nil, ErrInvoiceRequestOrders
	}
	ids := slices.Clone(input.OrderIds)
	slices.Sort(ids)
	if ids[0] <= 0 || len(slices.Compact(ids)) != len(input.OrderIds) {
		return nil, ErrInvoiceRequestOrders
	}
	request := &InvoiceRequest{UserId: userId, TitleType: input.TitleType, Title: input.Title, TaxId: input.TaxId, Email: input.Email, InvoiceAddress: input.InvoiceAddress, InvoicePhone: input.InvoicePhone, BankName: input.BankName, BankAccount: input.BankAccount, Remark: input.Remark, Status: InvoiceRequestPending, CreatedAt: common.GetTimestamp()}
	settings, err := GetInvoiceSettings()
	if err != nil {
		return nil, err
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		var orders []TopUp
		if err := lockForUpdate(tx).Where("id IN ? AND user_id = ?", ids, userId).Order("id ASC").Find(&orders).Error; err != nil {
			return err
		}
		if len(orders) != len(ids) {
			return ErrInvoiceRequestOrders
		}
		total := decimal.Zero
		for _, order := range orders {
			if order.Status != common.TopUpStatusSuccess || order.InvoiceStatus == TopUpInvoiceStatusIssued || order.Money <= 0 || math.IsNaN(order.Money) || math.IsInf(order.Money, 0) {
				return ErrInvoiceRequestOrders
			}
			if settings.ApplicationDays > 0 && (order.CompleteTime <= 0 || order.CompleteTime < request.CreatedAt-int64(settings.ApplicationDays)*86400 || order.CompleteTime > request.CreatedAt) {
				return common.NewMessage("Orders must be paid within the last {{days}} days", map[string]any{"days": settings.ApplicationDays})
			}
			total = total.Add(decimal.NewFromFloat(order.Money))
		}
		if total.LessThan(decimal.NewFromFloat(settings.MinimumAmount)) {
			return common.NewMessage("Invoice amount must be at least {{amount}}", map[string]any{"amount": strconv.FormatFloat(settings.MinimumAmount, 'f', -1, 64)})
		}
		var pending int64
		if err := tx.Model(&InvoiceRequestOrder{}).Where("active_top_up_id IN ?", ids).Count(&pending).Error; err != nil {
			return err
		}
		if pending > 0 {
			return ErrInvoiceRequestConflict
		}
		if err := tx.Omit("Orders").Create(request).Error; err != nil {
			return err
		}
		for _, order := range orders {
			id := order.Id
			request.Orders = append(request.Orders, InvoiceRequestOrder{RequestId: request.Id, TopUpId: id, ActiveTopUpId: &id, TradeNo: order.TradeNo, Money: order.Money})
		}
		return tx.Create(&request.Orders).Error
	})
	if err != nil {
		return nil, err
	}
	return request, nil
}

// WithdrawInvoiceRequest lets an applicant withdraw only their own pending
// application and releases its order claims while preserving its history.
func WithdrawInvoiceRequest(id, userId int) (*InvoiceRequest, error) {
	if id <= 0 || userId <= 0 {
		return nil, ErrInvoiceRequestProcessed
	}
	request := &InvoiceRequest{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ? AND status = ?", id, userId, InvoiceRequestPending).First(request).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return ErrInvoiceRequestProcessed
			}
			return err
		}
		if err := tx.Where("request_id = ?", id).Order("top_up_id ASC").Find(&request.Orders).Error; err != nil {
			return err
		}
		if err := tx.Model(&InvoiceRequestOrder{}).Where("request_id = ?", id).Update("active_top_up_id", nil).Error; err != nil {
			return err
		}
		request.Status = InvoiceRequestWithdrawn
		request.ProcessedAt = common.GetTimestamp()
		return tx.Model(request).Updates(map[string]any{
			"status":       request.Status,
			"processed_at": request.ProcessedAt,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return request, nil
}

type InvoiceProcessInput struct {
	Status        string `json:"status"`
	InvoiceNumber string `json:"invoice_number"`
	InvoiceURL    string `json:"invoice_url"`
	Note          string `json:"note"`
}

func ProcessInvoiceRequest(id, operatorId int, input InvoiceProcessInput) (*InvoiceRequest, error) {
	input.InvoiceNumber = strings.TrimSpace(input.InvoiceNumber)
	input.InvoiceURL = strings.TrimSpace(input.InvoiceURL)
	input.Note = strings.TrimSpace(input.Note)
	if id <= 0 || operatorId <= 0 || (input.Status != InvoiceRequestIssued && input.Status != InvoiceRequestRejected) || utf8.RuneCountInString(input.InvoiceNumber) > 100 || len(input.InvoiceURL) > 2000 || utf8.RuneCountInString(input.Note) > 1000 {
		return nil, ErrInvoiceRequestInput
	}
	if input.Status == InvoiceRequestIssued && input.InvoiceNumber == "" || input.Status == InvoiceRequestRejected && input.Note == "" {
		return nil, ErrInvoiceRequestInput
	}
	if input.InvoiceURL != "" {
		u, err := url.Parse(input.InvoiceURL)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil {
			return nil, ErrInvoiceRequestInput
		}
	}
	request := &InvoiceRequest{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("id = ? AND status = ?", id, InvoiceRequestPending).First(request).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				return ErrInvoiceRequestProcessed
			}
			return err
		}
		if err := tx.Where("request_id = ?", id).Order("top_up_id ASC").Find(&request.Orders).Error; err != nil {
			return err
		}
		if input.Status == InvoiceRequestIssued {
			// An uploaded file is attached separately; an empty link preserves it.
			if input.InvoiceURL == "" || strings.HasPrefix(request.InvoiceURL, "invoice-file:") {
				input.InvoiceURL = request.InvoiceURL
			}
			ids := make([]int, 0, len(request.Orders))
			for _, order := range request.Orders {
				ids = append(ids, order.TopUpId)
			}
			var orders []TopUp
			if err := lockForUpdate(tx).Where("id IN ? AND user_id = ?", ids, request.UserId).Order("id ASC").Find(&orders).Error; err != nil {
				return err
			}
			if len(orders) == 0 || len(orders) != len(ids) {
				return ErrInvoiceRequestOrders
			}
			for i, order := range orders {
				if order.Status != common.TopUpStatusSuccess || order.InvoiceStatus == TopUpInvoiceStatusIssued || order.Money != request.Orders[i].Money {
					return ErrInvoiceRequestOrders
				}
			}
			if err := tx.Model(&TopUp{}).Where("id IN ?", ids).Updates(billingInvoiceUpdates(TopUpInvoiceActionIssue, common.GetTimestamp(), operatorId)).Error; err != nil {
				return err
			}
		} else {
			// Retain attachments for the administrator's application history.
			input.InvoiceNumber, input.InvoiceURL = "", request.InvoiceURL
		}
		request.Status, request.InvoiceNumber, request.InvoiceURL, request.ProcessNote = input.Status, input.InvoiceNumber, input.InvoiceURL, input.Note
		request.ProcessedAt, request.ProcessedBy = common.GetTimestamp(), operatorId
		if err := tx.Omit("Orders").Save(request).Error; err != nil {
			return err
		}
		return tx.Model(&InvoiceRequestOrder{}).Where("request_id = ?", id).Update("active_top_up_id", nil).Error
	})
	if err != nil {
		return nil, err
	}
	return request, nil
}

type InvoiceSearch struct {
	Keyword   string `form:"keyword"`
	User      string `form:"user"`
	TitleType string `form:"title_type"`
	Start     int64  `form:"start_timestamp"`
	End       int64  `form:"end_timestamp"`
}

func (filter InvoiceSearch) Validate() error {
	if filter.Start < 0 || filter.End < 0 || filter.End > 0 && filter.Start > filter.End || len(filter.Keyword) > 200 || len(filter.User) > 100 || filter.TitleType != "" && filter.TitleType != "personal" && filter.TitleType != "company" {
		return ErrInvoiceRequestInput
	}
	return nil
}

func GetInvoiceEligibleOrders(userId int, page *common.PageInfo, filter InvoiceSearch) error {
	if err := filter.Validate(); err != nil {
		return err
	}
	pending := DB.Model(&InvoiceRequestOrder{}).Select("active_top_up_id").Where("active_top_up_id IS NOT NULL")
	query := DB.Model(&TopUp{}).Where("user_id = ? AND status = ? AND money > 0", userId, common.TopUpStatusSuccess).
		Where("(invoice_status IS NULL OR invoice_status <> ?)", TopUpInvoiceStatusIssued).
		Where("id NOT IN (?)", pending)
	settings, err := GetInvoiceSettings()
	if err != nil {
		return err
	}
	if settings.ApplicationDays > 0 {
		now := common.GetTimestamp()
		query = query.Where("complete_time > 0 AND complete_time >= ? AND complete_time <= ?", now-int64(settings.ApplicationDays)*86400, now)
	}
	if filter.Start > 0 {
		query = query.Where("complete_time >= ?", filter.Start)
	}
	if filter.End > 0 {
		query = query.Where("complete_time <= ?", filter.End)
	}
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		query = query.Where("trade_no LIKE ?", "%"+keyword+"%")
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return err
	}
	orders := make([]TopUp, 0)
	if err := query.Order("id DESC").Offset(page.GetStartIdx()).Limit(page.GetPageSize()).Find(&orders).Error; err != nil {
		return err
	}
	page.SetTotal(int(count))
	page.SetItems(orders)
	return nil
}

// userId = 0 is reserved for the administrator list handler.
func ListInvoiceRequests(userId int, status string, page *common.PageInfo, filter InvoiceSearch) error {
	if err := filter.Validate(); err != nil {
		return err
	}
	query := DB.Model(&InvoiceRequest{})
	if userId > 0 {
		query = query.Where("user_id = ?", userId)
	}
	if status != "" {
		if status != InvoiceRequestPending && status != InvoiceRequestIssued && status != InvoiceRequestRejected && status != InvoiceRequestWithdrawn {
			return ErrInvoiceRequestInput
		}
		query = query.Where("status = ?", status)
	}
	if filter.Start > 0 {
		query = query.Where("created_at >= ?", filter.Start)
	}
	if filter.End > 0 {
		query = query.Where("created_at <= ?", filter.End)
	}
	if filter.TitleType != "" {
		query = query.Where("title_type = ?", filter.TitleType)
	}
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		orders := DB.Model(&InvoiceRequestOrder{}).Select("request_id").Where("trade_no LIKE ?", like)
		query = query.Where("(title LIKE ? OR email LIKE ? OR tax_id LIKE ? OR invoice_number LIKE ? OR id IN (?))", like, like, like, like, orders)
	}
	if userId == 0 && strings.TrimSpace(filter.User) != "" {
		name := strings.TrimSpace(filter.User)
		users := DB.Model(&User{}).Select("id").Where("(username LIKE ? OR display_name LIKE ?)", "%"+name+"%", "%"+name+"%")
		if id, err := strconv.Atoi(name); err == nil && id > 0 {
			users = users.Or("id = ?", id)
		}
		query = query.Where("user_id IN (?)", users)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return err
	}
	requests := make([]InvoiceRequest, 0)
	if err := query.Preload("Orders").Order("id DESC").Offset(page.GetStartIdx()).Limit(page.GetPageSize()).Find(&requests).Error; err != nil {
		return err
	}
	if userId == 0 && len(requests) > 0 {
		ids := make([]int, 0, len(requests))
		for _, request := range requests {
			ids = append(ids, request.UserId)
		}
		var users []User
		if err := DB.Select("id", "username", "display_name").Where("id IN ?", ids).Find(&users).Error; err != nil {
			return err
		}
		byID := make(map[int]User, len(users))
		for _, user := range users {
			byID[user.Id] = user
		}
		for i := range requests {
			user := byID[requests[i].UserId]
			requests[i].Username, requests[i].DisplayName = user.Username, user.DisplayName
		}
	}
	if err := LoadInvoiceEmailHistory(requests); err != nil {
		return err
	}
	page.SetTotal(int(count))
	page.SetItems(requests)
	return nil
}
