package model

import (
	"context"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type RankingQuotaTotal struct {
	ModelName   string `json:"model_name"`
	TotalTokens int64  `json:"total_tokens"`
}

type RankingQuotaBucket struct {
	ModelName string `json:"model_name"`
	Bucket    int64  `json:"bucket"`
	Tokens    int64  `json:"tokens"`
}

func GetRankingQuotaTotals(startTime int64, endTime int64) ([]RankingQuotaTotal, error) {
	var rows []RankingQuotaTotal
	query := DB.Table("quota_data").
		Select("model_name, sum(token_used) as total_tokens").
		Where("model_name <> ''").
		Group("model_name").
		Having("sum(token_used) > 0").
		Order("total_tokens DESC")
	query = applyRankingQuotaTimeRange(query, startTime, endTime)
	err := query.Find(&rows).Error
	return rows, err
}

type ModelUsageTotal struct {
	ModelName string `json:"model_name"`
	Requests  int64  `json:"requests"`
	Tokens    int64  `json:"tokens"`
}

type GroupModelUsageTotal struct {
	ModelUsageTotal
	UseGroup string
}

// GetGroupModelUsageTotals reads the retained request logs. Historical dashboard
// buckets can combine groups whose names compare equal in a MySQL collation
// during writes, so grouping those buckets by exact name would still leak usage.
func GetGroupModelUsageTotals(ctx context.Context, startTime int64, endTime int64) ([]GroupModelUsageTotal, error) {
	query := LOG_DB.WithContext(ctx).Model(&Log{})
	modelName, useGroup := "model_name", "COALESCE("+query.Statement.Quote("group")+", '')"
	if common.UsingLogDatabase(common.DatabaseTypeMySQL) {
		modelName = "CAST(CONVERT(" + modelName + " USING utf8mb4) AS BINARY)"
		useGroup = "CAST(CONVERT(" + useGroup + " USING utf8mb4) AS BINARY)"
	}
	var rows []GroupModelUsageTotal
	query = applyUserVisibleLogFilter(query, "other").
		Select(modelName+" as model_name, "+useGroup+" as use_group, count(*) as requests, COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0) as tokens").
		Where("type = ? AND model_name <> ''", LogTypeConsume).
		// A later task debit adjusts the original request's charge.
		Where("(other IS NULL OR other LIKE ? OR other NOT LIKE ? OR other NOT LIKE ?)", `%"request_path":%`, `%"pre_consumed_quota":%`, `%"actual_quota":%`).
		Group(modelName + ", " + useGroup)
	query = applyRankingQuotaTimeRange(query, startTime, endTime)
	err := query.Find(&rows).Error
	return rows, err
}

func GetRankingQuotaBuckets(startTime int64, endTime int64, bucketSize int64) ([]RankingQuotaBucket, error) {
	if bucketSize <= 0 {
		bucketSize = 3600
	}
	bucketExpr := rankingBucketExpr(bucketSize)
	var rows []RankingQuotaBucket
	query := DB.Table("quota_data").
		Select(fmt.Sprintf("model_name, %s as bucket, sum(token_used) as tokens", bucketExpr)).
		Where("model_name <> ''").
		Group(fmt.Sprintf("model_name, %s", bucketExpr)).
		Having("sum(token_used) > 0").
		Order("bucket ASC")
	query = applyRankingQuotaTimeRange(query, startTime, endTime)
	err := query.Find(&rows).Error
	return rows, err
}

func rankingBucketExpr(bucketSize int64) string {
	if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		return fmt.Sprintf("FLOOR(created_at / %d) * %d", bucketSize, bucketSize)
	}
	return fmt.Sprintf("(created_at / %d) * %d", bucketSize, bucketSize)
}

func applyRankingQuotaTimeRange(query *gorm.DB, startTime int64, endTime int64) *gorm.DB {
	if startTime > 0 {
		query = query.Where("created_at >= ?", startTime)
	}
	if endTime > 0 {
		query = query.Where("created_at <= ?", endTime)
	}
	return query
}
