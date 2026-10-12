package model

const SystemTaskTypeIntelligenceTest = "intelligence_test"
const deletedIntelligenceResult = `{"deleted":true}`

// Preserve the schedule payload so deleting the latest result cannot repeat a
// scheduled run. Erase generated content and request IDs.
func DeleteIntelligenceTestResult(taskID string) (bool, error) {
	result := DB.Model(&SystemTask{}).Where("task_id = ? AND type = ? AND status IN ?", taskID, SystemTaskTypeIntelligenceTest, []SystemTaskStatus{SystemTaskStatusSucceeded, SystemTaskStatusFailed}).
		Where("result IS NULL OR result <> ?", deletedIntelligenceResult).
		Updates(map[string]any{"result": deletedIntelligenceResult, "error": ""})
	return result.RowsAffected > 0, result.Error
}

func ListIntelligenceTestHistory() ([]*SystemTask, error) {
	var tasks []*SystemTask
	err := DB.Where("type = ?", SystemTaskTypeIntelligenceTest).Where("result IS NULL OR result <> ?", deletedIntelligenceResult).Order("id desc").Limit(20).Find(&tasks).Error
	return tasks, err
}

func (task *SystemTask) IntelligenceResultDeleted() bool {
	return task.Result == deletedIntelligenceResult
}

// Pending intelligence runs are claimed oldest first, up to the shared slot limit.
func FindPendingIntelligenceTasks() ([]*SystemTask, error) {
	var tasks []*SystemTask
	err := DB.Where("type = ? AND status = ?", SystemTaskTypeIntelligenceTest, SystemTaskStatusPending).Order("id asc").Limit(SystemTaskConcurrency(SystemTaskTypeIntelligenceTest)).Find(&tasks).Error
	return tasks, err
}
