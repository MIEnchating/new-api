package service

import (
	"fmt"
	"html/template"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

var invoiceEmailTemplate = template.Must(template.New("invoice-email").Parse(`<!doctype html>
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
</table></td></tr></table></body></html>`))

func renderInvoiceEmail(request *model.InvoiceRequest, admin bool) (string, error) {
	// Invoice correspondence is intentionally Chinese, independent of UI language.
	translate := func(key string) string { return i18n.Translate("zh-CN", "invoice."+key, nil) }
	type row struct{ Label, Value string }
	rows := []row{{translate("application_id"), fmt.Sprintf("#%d", request.Id)}, {translate("title"), request.Title}}
	orders := request.Orders
	if len(orders) == 0 {
		if err := model.DB.Where("request_id = ?", request.Id).Find(&orders).Error; err != nil {
			return "", err
		}
	}
	amount := 0.0
	for _, order := range orders {
		amount += order.Money
	}
	rows = append(rows, row{translate("amount"), fmt.Sprintf("%.2f", amount)}, row{translate("recipient"), request.Email})
	data := struct {
		SystemName, Badge, Heading, Intro, URL, Action, Hint, Footer string
		Rows                                                         []row
	}{SystemName: common.SystemName, Badge: translate("issued_badge"), Heading: translate("email_subject"), Intro: translate("issued_intro"), URL: strings.TrimRight(system_setting.ServerAddress, "/") + "/invoices", Action: translate("view"), Hint: translate("attachment_hint"), Footer: translate("footer"), Rows: rows}
	if admin {
		applicant := fmt.Sprintf("#%d", request.UserId)
		var user model.User
		if err := model.DB.Select("id", "username", "display_name").First(&user, request.UserId).Error; err != nil {
			return "", err
		}
		if user.DisplayName != "" {
			applicant = user.DisplayName + " · " + applicant
		} else if user.Username != "" {
			applicant = user.Username + " · " + applicant
		}
		data.Rows = append([]row{{translate("applicant"), applicant}}, rows...)
		data.Badge, data.Heading, data.Intro = translate("pending_badge"), translate("notify_subject"), translate("pending_intro")
		data.URL, data.Action, data.Hint = strings.TrimRight(system_setting.ServerAddress, "/")+"/invoice-requests", translate("manage"), translate("admin_hint")
	} else {
		data.Rows = append(data.Rows, row{translate("number"), request.InvoiceNumber})
		if strings.HasPrefix(request.InvoiceURL, "https://") {
			data.URL, data.Hint = request.InvoiceURL, translate("link_hint")
		}
	}
	var content strings.Builder
	if err := invoiceEmailTemplate.Execute(&content, data); err != nil {
		return "", err
	}
	return content.String(), nil
}
