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
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import {
  useFieldArray,
  useForm,
  useWatch,
  type UseFormReturn,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { getSmartRoutingGroups } from '../api'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOptionsBulk } from '../hooks/use-update-option'
import {
  createSmartRoutingSchema,
  parseSmartRoutingTemplates,
  serializeSmartRoutingTemplates,
  type SmartRoutingFormValues,
  type SmartRoutingTemplateForm,
} from './smart-routing'

type SmartRoutingSectionProps = {
  defaultValues: {
    'smart_routing_setting.enabled': boolean
    'smart_routing_setting.templates': string
  }
}

type TemplateEditorProps = {
  form: UseFormReturn<SmartRoutingFormValues>
  index: number
  groupNames: string[]
  onRemove: () => void
}

function newSmartRoutingTemplate(): SmartRoutingTemplateForm {
  return {
    id: `route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    description: '',
    enabled: false,
    group_routes: [],
    group_route_sticky: false,
  }
}

function buildFormDefaults(
  defaults: SmartRoutingSectionProps['defaultValues']
): SmartRoutingFormValues {
  return {
    enabled: defaults['smart_routing_setting.enabled'],
    templates: parseSmartRoutingTemplates(
      defaults['smart_routing_setting.templates']
    ),
  }
}

function normalizeFormValues(values: SmartRoutingFormValues) {
  return {
    'smart_routing_setting.enabled': values.enabled,
    'smart_routing_setting.templates': serializeSmartRoutingTemplates(
      values.templates
    ),
  }
}

function SmartRoutingTemplateEditor(props: TemplateEditorProps) {
  const { t } = useTranslation()
  const templateName = useWatch({
    control: props.form.control,
    name: `templates.${props.index}.name`,
  })
  const routeFields = useFieldArray({
    control: props.form.control,
    name: `templates.${props.index}.group_routes`,
  })

  return (
    <Card size='sm'>
      <CardHeader>
        <CardTitle>
          {templateName ||
            t('Routing template #{{number}}', { number: props.index + 1 })}
        </CardTitle>
        <CardAction className='flex items-center gap-3'>
          <FormField
            control={props.form.control}
            name={`templates.${props.index}.enabled`}
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label={t('Enable routing template')}
                  />
                </FormControl>
              </FormItem>
            )}
          />
          <Button
            type='button'
            size='icon-sm'
            variant='ghost'
            className='text-destructive hover:text-destructive'
            aria-label={t('Remove routing template')}
            title={t('Remove routing template')}
            onClick={props.onRemove}
          >
            <Trash2 />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='grid gap-4 md:grid-cols-2'>
          <FormField
            control={props.form.control}
            name={`templates.${props.index}.name`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Template name')}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder={t('For example: Claude')} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={props.form.control}
            name={`templates.${props.index}.description`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Description')}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={2}
                    placeholder={t('Shown to users when creating an API key')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={props.form.control}
          name={`templates.${props.index}.group_route_sticky`}
          render={({ field }) => (
            <FormItem className='flex items-center justify-between gap-4 rounded-md border p-3'>
              <div className='space-y-0.5'>
                <FormLabel>{t('Group affinity')}</FormLabel>
                <FormDescription>
                  {t(
                    'After a fallback route succeeds, keep using that successful group until it fails.'
                  )}
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <div className='space-y-3'>
          <div className='flex items-center justify-between gap-3'>
            <FormLabel>{t('Group routing rules')}</FormLabel>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() =>
                routeFields.append({
                  group: '',
                  priority: routeFields.fields.length + 1,
                  cooldown_seconds: 60,
                  enabled: true,
                })
              }
              disabled={routeFields.fields.length >= 100}
            >
              <Plus data-icon='inline-start' />
              {t('Add route group')}
            </Button>
          </div>

          {routeFields.fields.map((route, routeIndex) => (
            <div
              key={route.id}
              className='grid min-w-0 gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_auto_auto] sm:items-end'
            >
              <FormField
                control={props.form.control}
                name={`templates.${props.index}.group_routes.${routeIndex}.group`}
                render={({ field, fieldState }) => (
                  <FormItem className='min-w-0'>
                    <FormLabel>{t('Group')}</FormLabel>
                    <Select
                      value={field.value || null}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger aria-invalid={fieldState.invalid}>
                          <SelectValue>
                            {field.value || t('Select a group')}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectGroup>
                          {props.groupNames.map((group) => (
                            <SelectItem key={group} value={group}>
                              {group}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={props.form.control}
                name={`templates.${props.index}.group_routes.${routeIndex}.priority`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Priority')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min='0'
                        step='1'
                        value={field.value}
                        onChange={(event) =>
                          field.onChange(Number(event.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={props.form.control}
                name={`templates.${props.index}.group_routes.${routeIndex}.cooldown_seconds`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Cooldown time (seconds)')}</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min='1'
                        max='31536000'
                        step='1'
                        value={field.value}
                        onChange={(event) =>
                          field.onChange(Number(event.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={props.form.control}
                name={`templates.${props.index}.group_routes.${routeIndex}.enabled`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Enabled')}</FormLabel>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        aria-label={t('Enable route group')}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button
                type='button'
                size='icon-sm'
                variant='ghost'
                className='text-destructive hover:text-destructive'
                aria-label={t('Remove route group')}
                title={t('Remove route group')}
                onClick={() => routeFields.remove(routeIndex)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}

          <FormField
            control={props.form.control}
            name={`templates.${props.index}.group_routes`}
            render={() => (
              <FormItem>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export function SmartRoutingSection(props: SmartRoutingSectionProps) {
  const { t } = useTranslation()
  const updateOptions = useUpdateOptionsBulk()
  const groupsQuery = useQuery({
    queryKey: ['smart-routing-groups'],
    queryFn: getSmartRoutingGroups,
    staleTime: 60_000,
  })
  const groupNames = (groupsQuery.data?.data || []).filter(
    (group) => group !== 'auto'
  )
  const formSchema = useMemo(() => createSmartRoutingSchema(t), [t])
  const formDefaults = useMemo(
    () => buildFormDefaults(props.defaultValues),
    [props.defaultValues]
  )
  const baselineRef = useRef(normalizeFormValues(formDefaults))
  const form = useForm<SmartRoutingFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: formDefaults,
  })
  const templateFields = useFieldArray({
    control: form.control,
    name: 'templates',
    keyName: 'fieldKey',
  })

  useResetForm(form, formDefaults)
  useEffect(() => {
    baselineRef.current = normalizeFormValues(formDefaults)
  }, [formDefaults])

  const onSubmit = async (values: SmartRoutingFormValues) => {
    const normalized = normalizeFormValues(values)
    const updates = (
      Object.keys(normalized) as Array<keyof typeof normalized>
    ).filter((key) => normalized[key] !== baselineRef.current[key])

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    try {
      await updateOptions.mutateAsync({
        options: updates.map((key) => ({ key, value: normalized[key] })),
      })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('Failed to update setting')
      )
      return
    }

    baselineRef.current = normalized
    form.reset(values)
    toast.success(t('Setting updated successfully'))
  }

  const addTemplate = () => templateFields.append(newSmartRoutingTemplate())

  return (
    <SettingsSection title={t('Smart Routing')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOptions.isPending}
          />

          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable API key smart routing')}</FormLabel>
                  <FormDescription>
                    {t('Provide routing templates when users create API keys.')}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <div className='space-y-4'>
            {templateFields.fields.length === 0 ? (
              <Empty className='border'>
                <EmptyHeader>
                  <EmptyTitle>
                    {t('No routing templates configured')}
                  </EmptyTitle>
                  <EmptyDescription>
                    {t('Add presets such as Claude, OpenAI, or Grok.')}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button type='button' variant='outline' onClick={addTemplate}>
                    <Plus data-icon='inline-start' />
                    {t('Add template')}
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <>
                {templateFields.fields.map((template, index) => (
                  <SmartRoutingTemplateEditor
                    key={template.fieldKey}
                    form={form}
                    index={index}
                    groupNames={groupNames}
                    onRemove={() => templateFields.remove(index)}
                  />
                ))}

                <Button
                  type='button'
                  variant='outline'
                  className='border-dashed'
                  onClick={addTemplate}
                  disabled={templateFields.fields.length >= 100}
                >
                  <Plus data-icon='inline-start' />
                  {t('Add template')}
                </Button>
              </>
            )}
          </div>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
