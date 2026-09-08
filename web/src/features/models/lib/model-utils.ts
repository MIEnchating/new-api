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
import type { Model } from '../types'

// ============================================================================
// Tags Parsing
// ============================================================================

/**
 * Parse tags string to array
 */
export function parseModelTags(tags: string | undefined): string[] {
  if (!tags) return []
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

// ============================================================================
// Endpoints Parsing
// ============================================================================

/**
 * Parse endpoints JSON string
 */
function parseEndpoints(
  endpoints: string | undefined
): Record<string, unknown> | unknown[] | null {
  if (!endpoints || endpoints.trim() === '') return null

  try {
    return JSON.parse(endpoints)
  } catch {
    return null
  }
}

/**
 * Format endpoints to display
 */
export function formatEndpointsDisplay(
  endpoints: string | undefined
): string[] {
  const parsed = parseEndpoints(endpoints)
  if (!parsed) return []

  if (typeof parsed === 'object' && !Array.isArray(parsed)) {
    return Object.keys(parsed)
  }

  if (Array.isArray(parsed)) {
    return parsed.map(String)
  }

  return []
}

// ============================================================================
// Model Status Utils
// ============================================================================

/**
 * Check if model is enabled
 */
export function isModelEnabled(model: Model): boolean {
  return model.status === 1
}

// Keep table labels compact; the drawer and tooltip share the full explanation.
export function getModelChannelState(model: Model) {
  const available = model.bound_channels?.length ?? 0
  const configured = model.configured_channel_count ?? available
  if (configured === 0) {
    if (model.name_rule !== 0) {
      return {
        label: 'No matching channels',
        description: 'No configured channel models match this metadata rule.',
      }
    }
    return {
      label: 'Metadata only',
      description:
        'No channel is configured. This model will not appear in the model square.',
    }
  }
  if (available === 0) {
    return {
      label: 'No available channels',
      description:
        'No channel is currently available. This model will not appear in the model square.',
    }
  }
  return {
    label: 'Available channels: {{count}}',
    description:
      'Listing also depends on metadata visibility and the user’s group access.',
  }
}
