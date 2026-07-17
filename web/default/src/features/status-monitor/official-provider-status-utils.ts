import type { TFunction } from 'i18next'

import type { OfficialProviderIncident, OfficialProviderStatus } from './types'

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

function normalizeStatus(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[-\s]+/g, '_')
}

export function isOfficialIncidentActive(incident: OfficialProviderIncident) {
  return !FINISHED_INCIDENT_STATUSES.has(normalizeStatus(incident.status))
}

export function getActiveOfficialIncidents(provider: OfficialProviderStatus) {
  return provider.incidents.filter(isOfficialIncidentActive)
}

export function getEffectiveOfficialIndicator(
  provider: OfficialProviderStatus
) {
  const declaredIndicator =
    normalizeStatus(provider.indicator || 'none') || 'none'
  if (declaredIndicator !== 'none') return declaredIndicator

  const activeIncidents = getActiveOfficialIncidents(provider)
  if (activeIncidents.length === 0) return 'none'

  const impacts = new Set(
    activeIncidents.map((incident) => normalizeStatus(incident.impact))
  )
  if (impacts.has('critical')) return 'critical'
  if (impacts.has('major')) return 'major'
  if (impacts.has('minor')) return 'minor'

  const hasMaintenance = activeIncidents.some((incident) => {
    const status = normalizeStatus(incident.status)
    return status === 'scheduled' || status === 'in_progress'
  })
  return hasMaintenance ? 'maintenance' : 'minor'
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
