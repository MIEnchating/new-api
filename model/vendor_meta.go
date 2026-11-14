package model

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// Vendor 用于存储供应商信息，供模型引用
// Name 唯一，用于在模型中关联
// Icon 采用 @lobehub/icons 的图标名，前端可直接渲染
// Status 预留字段，1 表示启用
// 本表同样遵循 3NF 设计范式

type Vendor struct {
	ModelCount  int64          `json:"model_count" gorm:"-"`
	Version     string         `json:"version,omitempty" gorm:"-"`
	Id          int            `json:"id"`
	Name        string         `json:"name" gorm:"size:128;not null;uniqueIndex:uk_vendor_name_delete_at,priority:1"`
	Description string         `json:"description,omitempty" gorm:"type:text"`
	Icon        string         `json:"icon,omitempty" gorm:"type:varchar(128)"`
	Status      int            `json:"status" gorm:"default:1"`
	CreatedTime int64          `json:"created_time" gorm:"bigint"`
	UpdatedTime int64          `json:"updated_time" gorm:"bigint"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index;uniqueIndex:uk_vendor_name_delete_at,priority:2"`
}

type VendorDisplay struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon,omitempty"`
}

// GetGroupVendors resolves current vendor metadata for configured group assignments.
// Older assignments used vendor names, while new assignments use stable IDs.
func GetGroupVendors(assignments map[string]string) (map[string]VendorDisplay, error) {
	ids := make(map[string]int, len(assignments))
	vendorIDs := make([]int, 0, len(assignments))
	hasLegacyNames := false
	for group, assignment := range assignments {
		value, hasID := strings.CutPrefix(assignment, "vendor:")
		if !hasID {
			hasLegacyNames = true
			continue
		}
		if id, err := strconv.Atoi(value); err == nil && id > 0 {
			ids[group] = id
			vendorIDs = append(vendorIDs, id)
		}
	}
	if len(vendorIDs) == 0 && !hasLegacyNames {
		return nil, nil
	}

	query := DB.Model(&Vendor{}).Select("id", "name", "icon")
	if !hasLegacyNames {
		query = query.Where("id IN ?", vendorIDs)
	}
	var vendors []VendorDisplay
	if err := query.Order("id").Find(&vendors).Error; err != nil {
		return nil, err
	}
	byID := make(map[int]VendorDisplay, len(vendors))
	for _, vendor := range vendors {
		byID[vendor.ID] = vendor
	}
	resolved := make(map[string]VendorDisplay, len(assignments))
	for group, assignment := range assignments {
		if strings.HasPrefix(assignment, "vendor:") {
			if vendor, ok := byID[ids[group]]; ok {
				resolved[group] = vendor
			}
			continue
		}
		for _, vendor := range vendors {
			if strings.EqualFold(vendor.Name, assignment) {
				resolved[group] = vendor
				break
			}
		}
	}
	return resolved, nil
}

// GetAutomaticGroupVendors classifies configured groups only when every model
// resolves to the same vendor. Disabled abilities remain part of the group so
// temporary channel outages cannot change its category.
func GetAutomaticGroupVendors(groups []string) (map[string]VendorDisplay, error) {
	aliases := make(map[string][]string, len(groups))
	var lookup []string
	for _, group := range groups {
		if group == "auto" {
			continue
		}
		for _, alias := range common.GroupNames(group) {
			aliases[alias] = append(aliases[alias], group)
			lookup = append(lookup, alias)
		}
	}
	if len(lookup) == 0 {
		return map[string]VendorDisplay{}, nil
	}
	var abilities []Ability
	if err := DB.Model(&Ability{}).Select(commonGroupCol, "model").
		Where(map[string]any{"group": lookup}).Distinct().Find(&abilities).Error; err != nil {
		return nil, err
	}
	var metadata []Model
	if err := DB.Select("id", "model_name", "name_rule", "vendor_id").Order("id").Find(&metadata).Error; err != nil {
		return nil, err
	}
	names := make([]string, 0, len(abilities))
	for _, ability := range abilities {
		names = append(names, ability.Model)
	}
	resolved := resolveModelMetadata(metadata, names)
	vendorIDs := make(map[string]int)
	ambiguous := make(map[string]bool)
	for _, ability := range abilities {
		vendorID := 0
		if record := resolved[ability.Model]; record != nil {
			vendorID = record.VendorID
		}
		for _, group := range aliases[ability.Group] {
			if vendorID <= 0 || vendorIDs[group] != 0 && vendorIDs[group] != vendorID {
				ambiguous[group] = true
			}
			vendorIDs[group] = vendorID
		}
	}
	assignments := make(map[string]string)
	for group, id := range vendorIDs {
		if !ambiguous[group] {
			assignments[group] = "vendor:" + strconv.Itoa(id)
		}
	}
	return GetGroupVendors(assignments)
}

// GetResolvedGroupVendors gives explicit assignments precedence over inferred
// categories and restricts both to the requested groups.
func GetResolvedGroupVendors(groups []string, assignments map[string]string) (map[string]VendorDisplay, error) {
	inferred, err := GetAutomaticGroupVendors(groups)
	if err != nil {
		return nil, err
	}
	if inferred == nil {
		inferred = make(map[string]VendorDisplay)
	}
	explicit := make(map[string]string)
	for _, group := range groups {
		if assignment := assignments[group]; assignment != "" {
			explicit[group] = assignment
			delete(inferred, group)
		}
	}
	vendors, err := GetGroupVendors(explicit)
	if err != nil {
		return nil, err
	}
	for group, vendor := range vendors {
		inferred[group] = vendor
	}
	return inferred, nil
}

// Insert 创建新的供应商记录
func (v *Vendor) Insert() error {
	v.Id = 0
	err := metadataTransaction(func(tx *gorm.DB) error {
		if err := validateVendorMetadata(tx, v); err != nil {
			return err
		}
		now := common.GetTimestamp()
		v.CreatedTime, v.UpdatedTime, v.Status = now, now, 1
		return tx.Create(v).Error
	})
	if err == nil {
		v.Version = VendorRecordVersion(v)
		RefreshPricing()
	}
	return err
}

// IsVendorNameDuplicated 检查供应商名称是否重复（排除自身 ID）
func IsVendorNameDuplicated(id int, name string) (bool, error) {
	if name == "" {
		return false, nil
	}
	var cnt int64
	err := DB.Model(&Vendor{}).Where("name = ? AND id <> ?", name, id).Count(&cnt).Error
	return cnt > 0, err
}

// Update 更新供应商记录
func (v *Vendor) Update() error {
	err := metadataTransaction(func(tx *gorm.DB) error {
		var saved Vendor
		if err := tx.First(&saved, v.Id).Error; err != nil {
			return err
		}
		if v.Version != "" && v.Version != VendorRecordVersion(&saved) {
			return ErrVendorConflict
		}
		if err := validateVendorMetadata(tx, v); err != nil {
			return err
		}
		v.CreatedTime, v.Status, v.UpdatedTime = saved.CreatedTime, saved.Status, common.GetTimestamp()
		return tx.Model(&Vendor{}).Where("id = ?", v.Id).Updates(map[string]any{"name": v.Name, "description": v.Description, "icon": v.Icon, "updated_time": v.UpdatedTime}).Error
	})
	if err == nil {
		v.Version = VendorRecordVersion(v)
		RefreshPricing()
	}
	return err
}

// Delete rejects referenced vendors rather than leaving orphaned model records.
func (v *Vendor) Delete() error { return DeleteVendors([]int{v.Id}) }

// GetVendorByID 根据 ID 获取供应商
func GetVendorByID(id int) (*Vendor, error) {
	var v Vendor
	err := DB.First(&v, id).Error
	if err != nil {
		return nil, err
	}
	if err := DB.Model(&Model{}).Where("vendor_id = ?", id).Count(&v.ModelCount).Error; err != nil {
		return nil, err
	}
	v.Version = VendorRecordVersion(&v)
	return &v, nil
}

// GetAllVendors 获取全部供应商（分页）
func GetAllVendors(offset int, limit int) ([]*Vendor, error) {
	vendors, _, err := SearchVendors("", offset, limit)
	return vendors, err
}

// SearchVendors filters persisted vendor records and counts actual model assignments.
func SearchVendors(keyword string, offset, limit int, association ...string) ([]*Vendor, int64, error) {
	db := DB.Model(&Vendor{})
	if keyword != "" {
		like := "%" + keyword + "%"
		db = db.Where("name LIKE ? OR description LIKE ?", like, like)
	}
	if len(association) > 0 {
		references := DB.Model(&Model{}).Select("1").Where("models.vendor_id = vendors.id")
		switch association[0] {
		case "linked":
			db = db.Where("EXISTS (?)", references)
		case "unlinked":
			db = db.Where("NOT EXISTS (?)", references)
		}
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var vendors []*Vendor
	if err := db.Offset(offset).Limit(limit).Order("id DESC").Find(&vendors).Error; err != nil {
		return nil, 0, err
	}
	counts, err := GetVendorModelCounts()
	if err != nil {
		return nil, 0, err
	}
	for _, vendor := range vendors {
		vendor.ModelCount = counts[int64(vendor.Id)]
		vendor.Version = VendorRecordVersion(vendor)
	}
	return vendors, total, nil
}
