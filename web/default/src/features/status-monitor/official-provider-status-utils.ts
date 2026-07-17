import type { TFunction } from 'i18next'

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
  const normalizedKey = value
    .trim()
    .toLowerCase()
    .replaceAll(/[-\s]+/g, '_')
  const translationKey = INCIDENT_STATUS_LABELS[normalizedKey]
  if (translationKey) return t(translationKey)

  const normalized = value.trim().replaceAll(/[_-]+/g, ' ')
  if (!normalized) return ''
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}
