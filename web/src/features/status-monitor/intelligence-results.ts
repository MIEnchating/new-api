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
import type { IntelligenceTask } from './intelligence-api'

export type IntelligenceCardData = {
  id: string
  task: IntelligenceTask
  group: string
  model: string
  status: IntelligenceTask['status']
  channel?: NonNullable<IntelligenceTask['result']>['channels'][number]
  counts?: Pick<NonNullable<IntelligenceTask['state']>, 'processed' | 'total'>
}

export function buildIntelligenceCards(
  history: IntelligenceTask[],
  groupOrder: string[] = []
): {
  cards: IntelligenceCardData[]
  groupCounts: Map<string, number>
} {
  const cards: IntelligenceCardData[] = []
  const groupCounts = new Map<string, number>()
  const groupRanks = new Map(groupOrder.map((group, index) => [group, index]))
  for (const task of history) {
    const taskCards: IntelligenceCardData[] = []
    const groups = task.groups?.length
      ? task.groups
      : [{ group: task.group, model: task.model }]
    for (const group of groups) {
      if (!groupCounts.has(group.group)) groupCounts.set(group.group, 0)
    }
    const completedModels = new Set<string>()
    for (const channel of task.result?.channels ?? []) {
      const group = channel.group || task.group
      const model = channel.model || task.model
      completedModels.add(JSON.stringify([group, model]))
      taskCards.push({
        id: JSON.stringify([
          task.task_id,
          group,
          model,
          channel.channel_id,
          channel.question_index,
        ]),
        task,
        group,
        model,
        channel,
        status: channel.error ? 'failed' : 'succeeded',
      })
    }
    const progressByModel = new Map(
      task.state?.models?.map((progress) => [
        JSON.stringify([progress.group, progress.model]),
        progress,
      ])
    )
    for (const group of groups) {
      const modelKey = JSON.stringify([group.group, group.model])
      const progress = progressByModel.get(modelKey)
      if (completedModels.has(modelKey)) {
        if (task.status !== 'running' && task.status !== 'pending') continue
        if (progress && progress.processed >= progress.total) continue
      }
      let status = task.status
      if (
        progress &&
        progress.total > 0 &&
        progress.processed >= progress.total
      ) {
        status = progress.failed === progress.total ? 'failed' : 'succeeded'
      }
      taskCards.push({
        id: JSON.stringify([
          task.task_id,
          group.group,
          group.model,
          'progress',
        ]),
        task,
        group: group.group,
        model: group.model,
        status,
        // Legacy batch progress only describes a model when it is the only model.
        counts: progress ?? (groups.length === 1 ? task.state : undefined),
      })
    }
    const modelRanks = new Map(
      groups.map((group, index) => [
        JSON.stringify([group.group, group.model]),
        index,
      ])
    )
    taskCards.sort((a, b) => {
      if (a.group !== b.group) {
        const rank =
          (groupRanks.get(a.group) ?? groupOrder.length) -
          (groupRanks.get(b.group) ?? groupOrder.length)
        return rank || a.group.localeCompare(b.group)
      }
      const rank =
        (modelRanks.get(JSON.stringify([a.group, a.model])) ?? groups.length) -
        (modelRanks.get(JSON.stringify([b.group, b.model])) ?? groups.length)
      return (
        rank ||
        a.model.localeCompare(b.model) ||
        (a.channel?.channel_id ?? Number.MAX_SAFE_INTEGER) -
          (b.channel?.channel_id ?? Number.MAX_SAFE_INTEGER) ||
        (a.channel?.question_index ?? 0) - (b.channel?.question_index ?? 0)
      )
    })
    cards.push(...taskCards)
  }
  // History is newest first. A run may expand into several model/question
  // results, so the API's 20-run limit is not a per-group card limit.
  const latestCards = cards.filter((card) => {
    const count = groupCounts.get(card.group) ?? 0
    if (count >= 20) return false
    groupCounts.set(card.group, count + 1)
    return true
  })
  const orderedGroups = [...groupCounts].sort(
    ([a], [b]) =>
      (groupRanks.get(a) ?? groupOrder.length) -
        (groupRanks.get(b) ?? groupOrder.length) || a.localeCompare(b)
  )
  return { cards: latestCards, groupCounts: new Map(orderedGroups) }
}
