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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { getLotteryNetQuota, getOrderManagementTotalQuota } from '../lib'
import type { BillingRecordType } from '../types'

describe('order management quota summaries', () => {
  test('subtracts net lottery rewards and accounts for reversals', () => {
    const quotas: Record<BillingRecordType, number> = {
      online_topup: 1000,
      redemption: 500,
      affiliate_transfer: 200,
      admin_adjustment: 100,
      lottery_reward: 80,
      lottery_reversal: -20,
    }

    assert.equal(getLotteryNetQuota(quotas), 60)
    assert.equal(getOrderManagementTotalQuota(quotas), 1540)
  })
})
