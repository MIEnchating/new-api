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

import { describe, test } from 'vitest'

import {
  getGroupRatioScheduleScope,
  isGroupRatioScheduleMap,
  isGroupRatioSchedulePeriodValid,
  parseGroupRatioSchedules,
  removeGroupRatioSchedule,
  renameGroupRatioSchedule,
  serializeGroupRatioSchedules,
  setGroupRatioScheduleScope,
} from '../group-ratio-schedule'

describe('group ratio schedule serialization', () => {
  test('round trips daily, weekday, and dated periods', () => {
    const schedules = {
      vip: {
        enabled: true,
        periods: [
          {
            name: 'Member Day',
            start: '23:00',
            end: '02:00',
            ratio: 0.5,
            enabled: true,
          },
          {
            days: [1, 3, 5],
            start: '08:00',
            end: '10:00',
            ratio: 0.8,
          },
          {
            date: '2026-08-05',
            start: '12:00',
            end: '14:00',
            ratio: 0.6,
          },
        ],
      },
    }

    assert.deepEqual(
      parseGroupRatioSchedules(serializeGroupRatioSchedules(schedules)),
      schedules
    )
    assert.equal(getGroupRatioScheduleScope(schedules.vip.periods[0]), 'daily')
    assert.equal(
      getGroupRatioScheduleScope(schedules.vip.periods[1]),
      'weekdays'
    )
    assert.equal(getGroupRatioScheduleScope(schedules.vip.periods[2]), 'date')
    assert.equal(schedules.vip.periods[0].name, 'Member Day')
  })

  test('renames and removes schedule keys with their groups', () => {
    const source = JSON.stringify({
      old: {
        enabled: true,
        periods: [{ start: '00:00', end: '23:59', ratio: 0.5 }],
      },
    })
    const renamed = renameGroupRatioSchedule(source, 'old', 'new')
    assert.equal(parseGroupRatioSchedules(renamed).old, undefined)
    assert.equal(parseGroupRatioSchedules(renamed).new.enabled, true)
    assert.deepEqual(
      parseGroupRatioSchedules(removeGroupRatioSchedule(renamed, 'new')),
      {}
    )
  })

  test('changes scope without retaining conflicting date and weekday fields', () => {
    const dated = setGroupRatioScheduleScope(
      { days: [1], start: '00:00', end: '01:00', ratio: 1 },
      'date'
    )
    assert.equal(dated.date, '')
    assert.equal(dated.days, undefined)

    const weekdays = setGroupRatioScheduleScope(dated, 'weekdays')
    assert.equal(weekdays.date, undefined)
    assert.deepEqual(weekdays.days, [1, 2, 3, 4, 5])

    const daily = setGroupRatioScheduleScope(weekdays, 'daily')
    assert.equal(daily.date, undefined)
    assert.equal(daily.days, undefined)
  })

  test('rejects incomplete dates, weekdays, times, and ratios', () => {
    assert.equal(
      isGroupRatioSchedulePeriodValid({
        start: '23:00',
        end: '02:00',
        ratio: 0,
      }),
      true
    )
    assert.equal(
      isGroupRatioSchedulePeriodValid({
        date: '',
        start: '00:00',
        end: '01:00',
        ratio: 1,
      }),
      false
    )
    assert.equal(
      isGroupRatioSchedulePeriodValid({
        days: [],
        start: '00:00',
        end: '01:00',
        ratio: 1,
      }),
      false
    )
    assert.equal(
      isGroupRatioSchedulePeriodValid({
        start: '24:00',
        end: '01:00',
        ratio: 1,
      }),
      false
    )
    assert.equal(
      isGroupRatioSchedulePeriodValid({
        start: '00:00',
        end: '01:00',
        ratio: Number.NaN,
      }),
      false
    )
  })

  test('validates the persisted schedule shape before saving', () => {
    assert.equal(
      isGroupRatioScheduleMap({
        vip: {
          enabled: true,
          periods: [{ days: [], start: '00:00', end: '23:59', ratio: 0.5 }],
        },
      }),
      true
    )
    assert.equal(
      isGroupRatioScheduleMap({
        vip: {
          enabled: true,
          periods: [
            {
              date: '2026-02-30',
              start: '00:00',
              end: '23:59',
              ratio: 0.5,
            },
          ],
        },
      }),
      false
    )
    assert.equal(
      isGroupRatioScheduleMap({
        vip: {
          enabled: true,
          periods: [
            {
              date: '2026-08-05',
              days: [3],
              start: '00:00',
              end: '23:59',
              ratio: 0.5,
            },
          ],
        },
      }),
      false
    )
    assert.equal(
      isGroupRatioScheduleMap({
        vip: {
          enabled: true,
          periods: [{ days: [1, 1], start: '00:00', end: '23:59', ratio: 0.5 }],
        },
      }),
      false
    )
    assert.equal(
      isGroupRatioScheduleMap({
        vip: {
          enabled: true,
          periods: [
            {
              name: 'a'.repeat(65),
              start: '00:00',
              end: '23:59',
              ratio: 0.5,
            },
          ],
        },
      }),
      false
    )
  })
})
