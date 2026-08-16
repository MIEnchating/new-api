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
import type { TFunction } from 'i18next'

import type {
  OfficialProviderComponent,
  OfficialProviderIncident,
  OfficialProviderStatus,
} from './types'

const INCIDENT_STATUS_LABELS: Record<string, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
  postmortem: 'Postmortem',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
}

const FINISHED_INCIDENT_STATUSES = new Set([
  'resolved',
  'completed',
  'postmortem',
])

const COMPONENT_STATUS_LABELS: Record<string, string> = {
  operational: 'Operational',
  degraded_performance: 'Degraded performance',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  under_maintenance: 'Under maintenance',
}

function normalizeStatus(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[-\s]+/g, '_')
}

function isOfficialIncidentActive(incident: OfficialProviderIncident) {
  return !FINISHED_INCIDENT_STATUSES.has(normalizeStatus(incident.status))
}

export function getActiveOfficialIncidents(provider: OfficialProviderStatus) {
  return provider.incidents.filter(isOfficialIncidentActive)
}

export function isOfficialComponentAffected(
  component: OfficialProviderComponent
) {
  return normalizeStatus(component.status) !== 'operational'
}

export function getAffectedOfficialComponents(
  provider: OfficialProviderStatus
) {
  return provider.components.filter(isOfficialComponentAffected)
}

export function getEffectiveOfficialIndicator(
  provider: OfficialProviderStatus
) {
  const declaredIndicator =
    normalizeStatus(provider.indicator || 'none') || 'none'
  const activeIncidents = getActiveOfficialIncidents(provider)
  const affectedComponents = getAffectedOfficialComponents(provider)
  const severityOrder = ['none', 'maintenance', 'minor', 'major', 'critical']
  const candidates = [declaredIndicator]

  for (const incident of activeIncidents) {
    const impact = normalizeStatus(incident.impact)
    if (impact !== 'none' && severityOrder.includes(impact)) {
      candidates.push(impact)
      continue
    }
    const status = normalizeStatus(incident.status)
    candidates.push(
      status === 'scheduled' || status === 'in_progress'
        ? 'maintenance'
        : 'minor'
    )
  }

  for (const component of affectedComponents) {
    switch (normalizeStatus(component.status)) {
      case 'major_outage':
        candidates.push('major')
        break
      case 'under_maintenance':
        candidates.push('maintenance')
        break
      default:
        candidates.push('minor')
        break
    }
  }

  const knownCandidates = candidates.filter((indicator) =>
    severityOrder.includes(indicator)
  )
  if (knownCandidates.length === 0) return declaredIndicator || 'unknown'
  return knownCandidates.reduce((highest, indicator) =>
    severityOrder.indexOf(indicator) > severityOrder.indexOf(highest)
      ? indicator
      : highest
  )
}

export function isOfficialProviderAffected(provider: OfficialProviderStatus) {
  return (
    !provider.available || getEffectiveOfficialIndicator(provider) !== 'none'
  )
}

export function formatOfficialTime(value: string, locale?: string) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

export function formatIncidentStatus(value: string, t: TFunction) {
  const normalizedKey = normalizeStatus(value)
  const translationKey = INCIDENT_STATUS_LABELS[normalizedKey]
  if (translationKey) return t(translationKey)

  const normalized = value.trim().replaceAll(/[_-]+/g, ' ')
  if (!normalized) return ''
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export function formatComponentStatus(value: string, t: TFunction) {
  const normalizedKey = normalizeStatus(value)
  const translationKey = COMPONENT_STATUS_LABELS[normalizedKey]
  if (translationKey) return t(translationKey)

  const normalized = value.trim().replaceAll(/[_-]+/g, ' ')
  if (!normalized) return t('Unknown status')
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}
