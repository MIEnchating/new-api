package model

import "github.com/QuantumNous/new-api/common"

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

// Compare the recorded payload and result as well as status: a concurrent retry
// or deletion must not be overwritten by a request based on an older snapshot.
func RequeueIntelligenceTest(task *SystemTask, payload, state, result any) (bool, error) {
	payloadText, err := marshalSystemTaskJSON(payload)
	if err != nil {
		return false, err
	}
	stateText, err := marshalSystemTaskJSON(state)
	if err != nil {
		return false, err
	}
	resultText, err := marshalSystemTaskJSON(result)
	if err != nil {
		return false, err
	}
	now := common.GetTimestamp()
	update := DB.Model(&SystemTask{}).
		Where("task_id = ? AND type = ? AND status IN ?", task.TaskID, SystemTaskTypeIntelligenceTest, []SystemTaskStatus{SystemTaskStatusSucceeded, SystemTaskStatusFailed}).
		Where("payload = ? AND result = ?", task.Payload, task.Result).
		Where("result <> ?", deletedIntelligenceResult).
		Updates(map[string]any{"payload": payloadText, "state": stateText, "result": resultText, "status": SystemTaskStatusPending, "error": "", "locked_by": "", "active_key": nil, "updated_at": now})
	if update.Error != nil || update.RowsAffected == 0 {
		return false, update.Error
	}
	task.Payload, task.State, task.Result = payloadText, stateText, resultText
	task.Status, task.Error, task.LockedBy, task.ActiveKey, task.UpdatedAt = SystemTaskStatusPending, "", "", nil, now
	return true, nil
}

// Queue work without changing the runner's result or lease. Snapshot matching
// rejects duplicate requests and requests racing with completion/deletion.
func QueueIntelligenceRetry(task *SystemTask, payload any) (bool, error) {
	if task.Status != SystemTaskStatusRunning && task.Status != SystemTaskStatusPending {
		return false, nil
	}
	payloadText, err := marshalSystemTaskJSON(payload)
	if err != nil {
		return false, err
	}
	update := DB.Model(&SystemTask{}).
		Where("task_id = ? AND type = ? AND status = ?", task.TaskID, SystemTaskTypeIntelligenceTest, task.Status).
		Where("payload = ?", task.Payload).
		Updates(map[string]any{"payload": payloadText, "updated_at": common.GetTimestamp()})
	if update.Error != nil || update.RowsAffected == 0 {
		return false, update.Error
	}
	task.Payload = payloadText
	return true, nil
}

// Finalization and accepting a retry compete on the same payload snapshot.
// If a retry won, the current runner must drain it before ending the batch.
func FinishIntelligenceTest(task *SystemTask, runnerID string, status SystemTaskStatus, result any, errorMessage string) (bool, error) {
	resultText, err := marshalSystemTaskJSON(result)
	if err != nil {
		return false, err
	}
	now := common.GetTimestamp()
	update := DB.Model(&SystemTask{}).
		Where("task_id = ? AND type = ? AND status = ? AND locked_by = ? AND payload = ?", task.TaskID, SystemTaskTypeIntelligenceTest, SystemTaskStatusRunning, runnerID, task.Payload).
		Where("EXISTS (SELECT 1 FROM system_task_locks WHERE system_task_locks.task_id = system_tasks.task_id AND system_task_locks.locked_by = ? AND system_task_locks.locked_until >= ?)", runnerID, now).
		Updates(map[string]any{"status": status, "active_key": nil, "result": resultText, "error": errorMessage, "updated_at": now})
	if update.Error != nil {
		return false, update.Error
	}
	if update.RowsAffected == 0 {
		current, err := GetSystemTaskByTaskID(task.TaskID)
		if err != nil {
			return false, err
		}
		if current != nil && current.Status == SystemTaskStatusRunning && current.LockedBy == runnerID && current.Payload != task.Payload {
			return false, nil
		}
		return false, ErrSystemTaskLockLost
	}
	return true, ReleaseSystemTaskLock(task.TaskID, runnerID)
}

// Queue polling must not load the potentially large HTML result on every tick.
func GetIntelligenceTaskExecution(taskID string) (*SystemTask, error) {
	var task SystemTask
	err := DB.Select("task_id", "status", "locked_by", "payload").Where("task_id = ?", taskID).First(&task).Error
	return &task, err
}
