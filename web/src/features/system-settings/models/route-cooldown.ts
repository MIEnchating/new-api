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
const DEFAULT_ROUTE_COOLDOWN_SECONDS = 60
const DEFAULT_SAME_CHANNEL_RETRIES = 1

export function resolveRouteCooldownToggle(
  currentSeconds: number,
  disabled: boolean,
  lastEnabledSeconds: number
): { value: number; lastEnabledSeconds: number } {
  const rememberedSeconds =
    lastEnabledSeconds > 0 ? lastEnabledSeconds : DEFAULT_ROUTE_COOLDOWN_SECONDS

  if (disabled) {
    return {
      value: 0,
      lastEnabledSeconds:
        currentSeconds > 0 ? currentSeconds : rememberedSeconds,
    }
  }

  return {
    value: rememberedSeconds,
    lastEnabledSeconds: rememberedSeconds,
  }
}

export function resolveSameChannelRetryToggle(
  currentRetries: number,
  disabled: boolean,
  lastEnabledRetries: number
): { value: number; lastEnabledRetries: number } {
  const rememberedRetries =
    lastEnabledRetries > 0 ? lastEnabledRetries : DEFAULT_SAME_CHANNEL_RETRIES

  if (disabled) {
    return {
      value: 0,
      lastEnabledRetries:
        currentRetries > 0 ? currentRetries : rememberedRetries,
    }
  }

  return {
    value: rememberedRetries,
    lastEnabledRetries: rememberedRetries,
  }
}
