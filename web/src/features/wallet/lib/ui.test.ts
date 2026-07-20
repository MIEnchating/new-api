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

import { PAYMENT_ICON_COLORS, PAYMENT_TYPES } from '../constants'
import { getPaymentIconColor } from './ui'

describe('payment icon colors', () => {
  test('keeps configured brand icons colored', () => {
    assert.equal(
      getPaymentIconColor(PAYMENT_TYPES.ALIPAY, 'SiAlipay'),
      PAYMENT_ICON_COLORS[PAYMENT_TYPES.ALIPAY]
    )
    assert.equal(
      getPaymentIconColor(PAYMENT_TYPES.WECHAT, 'SiWechat'),
      PAYMENT_ICON_COLORS[PAYMENT_TYPES.WECHAT]
    )
    assert.equal(
      getPaymentIconColor(PAYMENT_TYPES.STRIPE, 'SiStripe'),
      PAYMENT_ICON_COLORS[PAYMENT_TYPES.STRIPE]
    )
  })

  test('falls back to the payment type color for other configured icons', () => {
    assert.equal(
      getPaymentIconColor(PAYMENT_TYPES.ALIPAY, 'LuCreditCard'),
      PAYMENT_ICON_COLORS[PAYMENT_TYPES.ALIPAY]
    )
    assert.equal(getPaymentIconColor('custom', 'LuCreditCard'), undefined)
  })
})
