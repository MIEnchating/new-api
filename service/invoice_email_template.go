package service

import (
	"errors"
	"fmt"
	"html/template"
	"strings"
	texttemplate "text/template"
	"text/template/parse"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

const defaultInvoiceEmailHTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f6f8;color:#182230;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e5e9ef;border-radius:16px;overflow:hidden">
<tr><td style="padding:24px 28px;border-bottom:1px solid #e5e9ef;font-size:14px;font-weight:600;color:#667085">{{.SystemName}}</td></tr>
<tr><td style="padding:28px"><p style="margin:0 0 12px;color:#2563eb;font-size:12px;font-weight:600">{{.Badge}}</p><h1 style="margin:0 0 12px;font-size:24px;line-height:1.4">{{.Heading}}</h1><p style="margin:0 0 24px;font-size:14px;line-height:1.8;color:#667085">{{.Intro}}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:14px;line-height:1.7;border-top:1px solid #e5e9ef">{{range .Rows}}<tr><td width="100" valign="top" style="padding:12px 8px 12px 0;border-bottom:1px solid #eef1f5;color:#667085">{{.Label}}</td><td valign="top" style="padding:12px 0;border-bottom:1px solid #eef1f5;word-break:break-all">{{.Value}}</td></tr>{{end}}</table>
{{if .URL}}<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:24px"><tr><td bgcolor="#2563eb" style="border-radius:8px"><a href="{{.URL}}" style="display:inline-block;padding:12px 24px;color:#fff;font-size:14px;font-weight:600;text-decoration:none">{{.Action}}</a></td></tr></table>{{end}}
<p style="margin:24px 0 0;color:#667085;font-size:13px;line-height:1.8">{{.Hint}}</p></td></tr>
<tr><td style="padding:18px 28px;background:#f8fafc;color:#667085;font-size:12px;line-height:1.7">{{.Footer}}</td></tr>
</table></td></tr></table></body></html>`

type invoiceEmailRow struct{ Label, Value string }
type invoiceEmailData struct {
	SystemName, Badge, Heading, Intro, URL, Action, Hint, Footer  string
	ApplicationID, Title, Amount, Email, InvoiceNumber, Applicant string
	Rows                                                          []invoiceEmailRow
}

func invoiceEmailValues(request *model.InvoiceRequest, admin bool) invoiceEmailData {
	// Invoice correspondence is intentionally Chinese, independent of UI language.
	translate := func(key string) string { return i18n.Translate("zh-CN", "invoice."+key, nil) }
	type row = invoiceEmailRow
	rows := []row{{translate("application_id"), fmt.Sprintf("#%d", request.Id)}, {translate("title"), request.Title}}
	orders := request.Orders
	amount := 0.0
	for _, order := range orders {
		amount += order.Money
	}
	rows = append(rows, row{translate("amount"), fmt.Sprintf("%.2f", amount)}, row{translate("recipient"), request.Email})
	data := invoiceEmailData{SystemName: common.SystemName, Badge: translate("issued_badge"), Heading: translate("email_subject"), Intro: translate("issued_intro"), URL: strings.TrimRight(system_setting.ServerAddress, "/") + "/invoices", Action: translate("view"), Hint: translate("attachment_hint"), Footer: translate("footer"), Rows: rows, ApplicationID: fmt.Sprintf("#%d", request.Id), Title: request.Title, Amount: fmt.Sprintf("%.2f", amount), Email: request.Email, InvoiceNumber: request.InvoiceNumber}
	if admin {
		applicant := fmt.Sprintf("#%d", request.UserId)
		if request.DisplayName != "" {
			applicant = request.DisplayName + " · " + applicant
		} else if request.Username != "" {
			applicant = request.Username + " · " + applicant
		}
		data.Applicant = applicant
		data.Rows = append([]row{{translate("applicant"), applicant}}, rows...)
		data.Badge, data.Heading, data.Intro = translate("pending_badge"), translate("notify_subject"), translate("pending_intro")
		data.URL, data.Action, data.Hint = strings.TrimRight(system_setting.ServerAddress, "/")+"/invoice-requests", translate("manage"), translate("admin_hint")
	} else {
		data.Rows = append(data.Rows, row{translate("number"), request.InvoiceNumber})
		if strings.HasPrefix(request.InvoiceURL, "https://") {
			data.URL, data.Hint = request.InvoiceURL, translate("link_hint")
		}
	}

	return data
}

type RenderedInvoiceEmail struct {
	Subject string `json:"subject"`
	HTML    string `json:"html"`
}

func DefaultInvoiceEmailTemplates() model.InvoiceEmailTemplates {
	return model.InvoiceEmailTemplates{
		Admin:    model.InvoiceEmailTemplate{Subject: i18n.Translate("zh-CN", "invoice.notify_subject", nil), HTML: defaultInvoiceEmailHTML},
		Customer: model.InvoiceEmailTemplate{Subject: i18n.Translate("zh-CN", "invoice.email_subject", nil), HTML: defaultInvoiceEmailHTML},
	}
}

func GetInvoiceEmailTemplates() (model.InvoiceEmailTemplates, error) {
	saved, err := model.GetInvoiceEmailTemplates()
	if err != nil {
		return saved, err
	}
	defaults := DefaultInvoiceEmailTemplates()
	if saved.Admin.HTML == "" {
		saved.Admin = defaults.Admin
	}
	if saved.Customer.HTML == "" {
		saved.Customer = defaults.Customer
	}
	return saved, nil
}

// Restrict templates to fields, conditionals and the finite Rows collection.
// No functions, recursive templates or access to application objects.
func validateInvoiceTemplateNode(node parse.Node, depth int) bool {
	if depth > 20 {
		return false
	}
	switch n := node.(type) {
	case *parse.ListNode:
		if n == nil {
			return true
		}
		for _, child := range n.Nodes {
			if !validateInvoiceTemplateNode(child, depth+1) {
				return false
			}
		}
	case *parse.TextNode, *parse.FieldNode:
		return true
	case *parse.ActionNode:
		return validateInvoiceTemplateNode(n.Pipe, depth+1)
	case *parse.PipeNode:
		return len(n.Decl) == 0 && len(n.Cmds) == 1 && validateInvoiceTemplateNode(n.Cmds[0], depth+1)
	case *parse.CommandNode:
		if len(n.Args) != 1 {
			return false
		}
		_, ok := n.Args[0].(*parse.FieldNode)
		return ok
	case *parse.IfNode:
		return validateInvoiceTemplateNode(n.Pipe, depth+1) && validateInvoiceTemplateNode(n.List, depth+1) && validateInvoiceTemplateNode(n.ElseList, depth+1)
	case *parse.RangeNode:
		return n.Pipe.String() == ".Rows" && validateInvoiceTemplateNode(n.List, depth+1) && validateInvoiceTemplateNode(n.ElseList, depth+1)
	default:
		return false
	}
	return true
}

type invoiceEmailOutput struct{ strings.Builder }

func (output *invoiceEmailOutput) Write(p []byte) (int, error) {
	if output.Len()+len(p) > 128<<10 {
		return 0, errors.New("email template output too large")
	}
	return output.Builder.Write(p)
}

func renderInvoiceEmailTemplate(input model.InvoiceEmailTemplate, data invoiceEmailData) (*RenderedInvoiceEmail, error) {
	invalid := common.NewMessage("Invalid invoice email template")
	if strings.TrimSpace(input.Subject) == "" || utf8.RuneCountInString(input.Subject) > 200 || strings.ContainsAny(input.Subject, "\r\n") || strings.TrimSpace(input.HTML) == "" || len(input.HTML) > 32<<10 {
		return nil, invalid
	}
	subject, err := texttemplate.New("subject").Option("missingkey=error").Parse(input.Subject)
	if err != nil || len(subject.Templates()) != 1 || !validateInvoiceTemplateNode(subject.Tree.Root, 0) {
		return nil, invalid
	}
	body, err := template.New("body").Option("missingkey=error").Parse(input.HTML)
	if err != nil || len(body.Templates()) != 1 || !validateInvoiceTemplateNode(body.Tree.Root, 0) {
		return nil, invalid
	}
	var renderedSubject, renderedHTML invoiceEmailOutput
	if err := subject.Execute(&renderedSubject, data); err != nil {
		return nil, invalid
	}
	if strings.TrimSpace(renderedSubject.String()) == "" || strings.ContainsAny(renderedSubject.String(), "\r\n") || utf8.RuneCountInString(renderedSubject.String()) > 200 {
		return nil, invalid
	}
	// Keep the default body heading in sync with the fully rendered subject.
	data.Heading = renderedSubject.String()
	if err := body.Execute(&renderedHTML, data); err != nil {
		return nil, invalid
	}
	return &RenderedInvoiceEmail{Subject: renderedSubject.String(), HTML: renderedHTML.String()}, nil
}

func PreviewInvoiceEmail(input model.InvoiceEmailTemplate, kind string) (*RenderedInvoiceEmail, error) {
	if kind != "admin" && kind != "customer" {
		return nil, common.NewMessage("Invalid invoice email template")
	}
	request := &model.InvoiceRequest{Id: 128, UserId: 8, Title: "示例科技有限公司", Email: "billing@example.com", InvoiceNumber: "12345678901234567890", DisplayName: "示例用户", Orders: []model.InvoiceRequestOrder{{Money: 125.50}}}
	return renderInvoiceEmailTemplate(input, invoiceEmailValues(request, kind == "admin"))
}

func SaveInvoiceEmailTemplates(input model.InvoiceEmailTemplates) error {
	if _, err := PreviewInvoiceEmail(input.Admin, "admin"); err != nil {
		return err
	}
	if _, err := PreviewInvoiceEmail(input.Customer, "customer"); err != nil {
		return err
	}
	return model.SaveInvoiceEmailTemplates(input)
}

func renderInvoiceEmail(request *model.InvoiceRequest, admin bool) (*RenderedInvoiceEmail, error) {
	copy := *request
	if len(copy.Orders) == 0 {
		if err := model.DB.Where("request_id = ?", copy.Id).Find(&copy.Orders).Error; err != nil {
			return nil, err
		}
	}
	if admin {
		var user model.User
		if err := model.DB.Select("id", "username", "display_name").First(&user, copy.UserId).Error; err != nil {
			return nil, err
		}
		copy.Username, copy.DisplayName = user.Username, user.DisplayName
	}
	settings, err := GetInvoiceEmailTemplates()
	if err != nil {
		return nil, err
	}
	source := settings.Customer
	if admin {
		source = settings.Admin
	}
	return renderInvoiceEmailTemplate(source, invoiceEmailValues(&copy, admin))
}
