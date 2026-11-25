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
import type { SystemStatus } from '@/features/auth/types'

export type ReferralProgramRewards = {
  registrationRewards: boolean
  firstTopupRate: number
  walletRatePercent: number
  days: number
}

export function getReferralProgramRewards(
  program: SystemStatus['referral_program']
): ReferralProgramRewards | null {
  if (!program?.enabled) return null

  const registrationRewards = program.registration_rewards_enabled === true
  const firstTopupRate = program.first_topup_rebate_ratio ?? 0
  const walletRatePercent =
    program.wallet_usage_enabled === false ? 0 : program.rate_percent
  if (!registrationRewards && firstTopupRate <= 0 && walletRatePercent <= 0) {
    return null
  }

  return {
    registrationRewards,
    firstTopupRate,
    walletRatePercent,
    days: program.days,
  }
}
