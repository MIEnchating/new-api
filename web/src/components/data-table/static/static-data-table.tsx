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
import { Reorder } from 'motion/react'
import * as React from 'react'

import { OrderDragItem } from '@/components/auto-group-order-item'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

import { TruncatedCell } from '../core/truncated-cell'
import { staticDataTableClassNames } from './static-data-table-classnames'

type StaticDataTableBaseProps = {
  className?: string
  tableClassName?: string
  containerProps?: Omit<React.ComponentProps<'div'>, 'className' | 'children'>
  tableProps?: Omit<
    React.ComponentProps<typeof Table>,
    'className' | 'children'
  >
}

type RowReorder<TData> = {
  getValue: (row: TData) => string
  getLabel: (row: TData) => string
  onReorder: (values: string[]) => void
  disabled?: boolean
}

type StaticDataTableDataProps<TData = unknown> = StaticDataTableBaseProps & {
  columns: StaticDataTableColumn<TData>[]
  data: TData[]
  getRowKey?: (row: TData, index: number) => React.Key
  getRowClassName?: (row: TData, index: number) => string | undefined
  reorder?: RowReorder<TData>
  getRowProps?: (
    row: TData,
    index: number
  ) => Omit<React.ComponentProps<typeof TableRow>, 'children'>
  renderRow?: (row: TData, index: number) => React.ReactNode
  empty?: boolean
  emptyContent?: React.ReactNode
  emptyClassName?: string
  headerRowClassName?: string
}

type StaticDataTableChildrenProps = StaticDataTableBaseProps & {
  children: React.ReactNode
  columns?: never
  data?: never
}

type StaticDataTableProps<TData = unknown> =
  | StaticDataTableDataProps<TData>
  | StaticDataTableChildrenProps

type StaticDataTableColumn<TData = unknown> = {
  id: string
  header: React.ReactNode
  className?: string
  cellClassName?: string | ((row: TData, index: number) => string | undefined)
  cell?: (
    row: TData,
    index: number,
    dragHandle?: React.ReactNode
  ) => React.ReactNode
}

export function StaticDataTable<TData = unknown>(
  props: StaticDataTableProps<TData>
) {
  const { className, tableClassName, containerProps, tableProps } = props

  return (
    <div
      className={cn(staticDataTableClassNames.container, className)}
      {...containerProps}
    >
      <Table className={tableClassName} {...tableProps}>
        {props.columns !== undefined ? (
          <StaticDataTableWithColumns {...props} />
        ) : (
          props.children
        )}
      </Table>
    </div>
  )
}

function StaticDataTableWithColumns<TData>({
  columns,
  data,
  getRowKey,
  getRowClassName,
  reorder,
  getRowProps,
  renderRow,
  empty,
  emptyContent,
  emptyClassName,
  headerRowClassName,
}: StaticDataTableDataProps<TData>) {
  const isEmpty = empty ?? (data !== undefined && data.length === 0)
  const order = reorder && data.map(reorder.getValue)
  const moveRow = (index: number, direction: 'up' | 'down') => {
    if (!reorder || reorder.disabled || !order) return
    const target = index + (direction === 'up' ? -1 : 1)
    if (target < 0 || target >= order.length) return
    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]
    reorder.onReorder(next)
  }
  const bodyRows = data.map((row, index) => (
    <StaticDataTableRow
      key={getRowKey?.(row, index) ?? index}
      row={row}
      index={index}
      columns={columns}
      getRowClassName={getRowClassName}
      reorder={reorder}
      onMove={(direction) => moveRow(index, direction)}
      getRowProps={getRowProps}
      renderRow={renderRow}
    />
  ))

  return (
    <>
      <TableHeader>
        <TableRow className={headerRowClassName}>
          {columns.map((column) => (
            <TableHead key={column.id} className={column.className}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      {reorder && order && !isEmpty ? (
        <Reorder.Group
          as='tbody'
          axis='y'
          values={order}
          onReorder={reorder.onReorder}
          data-slot='table-body'
          className='[&_tr:last-child]:border-0 [&>tr]:h-15'
        >
          {bodyRows}
        </Reorder.Group>
      ) : (
        <TableBody>
          {isEmpty ? (
            <StaticDataTableEmptyRow
              colSpan={columns.length}
              className={emptyClassName}
            >
              {emptyContent}
            </StaticDataTableEmptyRow>
          ) : (
            bodyRows
          )}
        </TableBody>
      )}
    </>
  )
}

type StaticDataTableRowProps<TData> = Required<
  Pick<StaticDataTableDataProps<TData>, 'columns'>
> &
  Pick<
    StaticDataTableDataProps<TData>,
    'getRowClassName' | 'reorder' | 'getRowProps' | 'renderRow'
  > & {
    row: TData
    index: number
    onMove: (direction: 'up' | 'down') => void
  }

function StaticDataTableRow<TData>({
  row,
  index,
  columns,
  getRowClassName,
  reorder,
  onMove,
  getRowProps,
  renderRow,
}: StaticDataTableRowProps<TData>) {
  if (renderRow) {
    return <>{renderRow(row, index)}</>
  }

  const rowProps = getRowProps?.(row, index)
  const rowClassName = cn(rowProps?.className, getRowClassName?.(row, index))
  const rowContent = (dragHandle?: React.ReactNode) =>
    columns.map((column) => (
      <TableCell
        key={column.id}
        className={cn(
          'max-w-full min-w-0 overflow-hidden',
          getStaticCellClassName(column, row, index)
        )}
      >
        {renderStaticCellContent(column, row, index, dragHandle)}
      </TableCell>
    ))

  if (reorder) {
    return (
      <OrderDragItem
        as='tr'
        slot='table-row'
        value={reorder.getValue(row)}
        label={reorder.getLabel(row)}
        disabled={reorder.disabled}
        onMove={onMove}
        className={cn('group bg-background relative border-b', rowClassName)}
      >
        {rowContent}
      </OrderDragItem>
    )
  }

  return (
    <TableRow {...rowProps} className={rowClassName}>
      {rowContent()}
    </TableRow>
  )
}

function renderStaticCellContent<TData>(
  column: StaticDataTableColumn<TData>,
  row: TData,
  index: number,
  dragHandle?: React.ReactNode
) {
  const content = column.cell?.(row, index, dragHandle)
  const textContent = getPrimitiveTextContent(content)

  if (!textContent) return content

  return <TruncatedCell tooltipContent={textContent}>{content}</TruncatedCell>
}

function getPrimitiveTextContent(content: React.ReactNode): string | null {
  if (typeof content === 'string' || typeof content === 'number') {
    return String(content)
  }

  if (
    React.isValidElement<{ children?: React.ReactNode }>(content) &&
    (typeof content.props.children === 'string' ||
      typeof content.props.children === 'number')
  ) {
    return String(content.props.children)
  }

  return null
}

function getStaticCellClassName<TData>(
  column: StaticDataTableColumn<TData>,
  row: TData,
  index: number
) {
  return typeof column.cellClassName === 'function'
    ? column.cellClassName(row, index)
    : column.cellClassName
}

type StaticDataTableEmptyRowProps = {
  colSpan: number
  children: React.ReactNode
  className?: string
}

function StaticDataTableEmptyRow({
  colSpan,
  children,
  className,
}: StaticDataTableEmptyRowProps) {
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        className={cn('h-24 text-center', className)}
      >
        {children}
      </TableCell>
    </TableRow>
  )
}
