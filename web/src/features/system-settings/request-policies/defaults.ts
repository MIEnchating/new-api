/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { ChannelAffinitySettings } from '../general/channel-affinity/types'
import { DEFAULT_REQUEST_ERROR_ROUTING_RULES_JSON } from '../models/request-error-routing-rules'
import type { ModelSettings, SecuritySettings } from '../types'

export type RetrySettings = {
  RetryTimes: number
  AutomaticRetryStatusCodes: string
}
export type HealthSettings = {
  ChannelDisableThreshold: string
  AutomaticDisableChannelEnabled: boolean
  AutomaticEnableChannelEnabled: boolean
  AutomaticDisableKeywords: string
  AutomaticDisableStatusCodes: string
  'monitor_setting.auto_test_channel_enabled': boolean
  'monitor_setting.auto_test_channel_minutes': number
  'monitor_setting.channel_test_concurrency': number
  'monitor_setting.channel_test_mode':
    | 'scheduled_all'
    | 'auto_ban_only'
    | 'passive_recovery'
}
export type FilteringSettings = Pick<
  SecuritySettings,
  'CheckSensitiveEnabled' | 'CheckSensitiveOnPromptEnabled' | 'SensitiveWords'
>
export type RequestPolicySettings = RetrySettings &
  HealthSettings &
  FilteringSettings &
  Pick<
    ModelSettings,
    | 'ChannelRouteCooldownEnabled'
    | 'ChannelRouteCooldownSeconds'
    | 'ChannelRouteCooldownExcludedGroups'
    | 'ChannelRouteSameChannelRetries'
    | 'ChannelRouteGroupExclusionsEnabled'
    | 'ChannelRouteGroupExclusions'
    | 'error_response_setting.enabled'
    | 'error_response_setting.rules'
    | 'request_error_routing_setting.enabled'
    | 'request_error_routing_setting.rules'
  > &
  Pick<ChannelAffinitySettings, keyof ChannelAffinitySettings>

export const defaultRequestPolicySettings: RequestPolicySettings = {
  RetryTimes: 0,
  ChannelRouteCooldownEnabled: false,
  ChannelRouteCooldownSeconds: 60,
  ChannelRouteCooldownExcludedGroups: '[]',
  ChannelRouteSameChannelRetries: 0,
  ChannelRouteGroupExclusionsEnabled: true,
  ChannelRouteGroupExclusions: '{}',
  'error_response_setting.enabled': false,
  'error_response_setting.rules': '[]',
  'request_error_routing_setting.enabled': true,
  'request_error_routing_setting.rules':
    DEFAULT_REQUEST_ERROR_ROUTING_RULES_JSON,
  AutomaticRetryStatusCodes:
    '100-199,300-399,401-407,409-499,500-503,505-523,525-599',
  ChannelDisableThreshold: '',
  AutomaticDisableChannelEnabled: false,
  AutomaticEnableChannelEnabled: false,
  AutomaticDisableKeywords: '',
  AutomaticDisableStatusCodes: '401',
  'monitor_setting.auto_test_channel_enabled': false,
  'monitor_setting.auto_test_channel_minutes': 10,
  'monitor_setting.channel_test_concurrency': 1,
  'monitor_setting.channel_test_mode': 'scheduled_all',
  'channel_affinity_setting.enabled': false,
  'channel_affinity_setting.session_mode': '',
  'channel_affinity_setting.switch_on_success': true,
  'channel_affinity_setting.keep_on_channel_disabled': false,
  'channel_affinity_setting.max_entries': 100000,
  'channel_affinity_setting.default_ttl_seconds': 3600,
  'channel_affinity_setting.rules': '[]',
  CheckSensitiveEnabled: false,
  CheckSensitiveOnPromptEnabled: false,
  SensitiveWords: '',
}
