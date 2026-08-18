package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type lotteryConfigRequest struct {
	Rules      *model.LotteryRules             `json:"rules"`
	Prizes     *[]model.LotteryPrize           `json:"prizes"`
	GrantRules *[]model.LotteryChanceGrantRule `json:"grant_rules"`
}

type lotteryRewardRevokeRequest struct {
	Reason string `json:"reason" binding:"required"`
}

func GetLotteryStatus(c *gin.Context) {
	status, err := model.GetLotteryStatus(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, status)
}

func DrawLottery(c *gin.Context) {
	result, err := model.DrawLottery(c.GetInt("id"))
	if err != nil {
		if errors.Is(err, model.ErrNoLotteryChances) {
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": "No lottery chances available",
			})
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetUserLotteryDraws(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("p", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	result, err := model.GetUserLotteryDraws(c.GetInt("id"), page, pageSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func GetLotteryConfig(c *gin.Context) {
	common.ApiSuccess(c, model.GetLotteryConfig())
}

func UpdateLotteryConfig(c *gin.Context) {
	var request lotteryConfigRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	config := model.GetLotteryConfig()
	if request.Rules != nil {
		config.Rules = *request.Rules
	}
	if request.Prizes != nil {
		config.Prizes = *request.Prizes
	}
	if request.GrantRules != nil {
		config.GrantRules = *request.GrantRules
	}
	if err := model.UpdateLotteryConfig(config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	common.ApiSuccess(c, model.GetLotteryConfig())
}

func GetAllLotteryDraws(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("p", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	result, err := model.GetAllLotteryDraws(page, pageSize, model.LotteryDrawFilter{
		UserKeyword: c.Query("user"),
		Result:      c.Query("result"),
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func RevokeLotteryReward(c *gin.Context) {
	drawId, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || drawId <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid lottery draw"})
		return
	}
	var request lotteryRewardRevokeRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := model.RevokeLotteryReward(drawId, c.GetInt("id"), request.Reason); err != nil {
		if errors.Is(err, model.ErrLotteryDrawAlreadyRevoked) ||
			errors.Is(err, model.ErrLotteryDrawNotReversible) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
