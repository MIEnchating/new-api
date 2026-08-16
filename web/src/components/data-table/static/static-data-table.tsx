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
import {
  defaultDropAnimationSideEffects,
  DragOverlay,
  useDndContext,
  type DropAnimation,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import * as React from 'react'
import { createPortal } from 'react-dom'

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

type StaticDataTableDataProps<TData = unknown> = StaticDataTableBaseProps & {
  columns: StaticDataTableColumn<TData>[]
  data: TData[]
  getRowKey?: (row: TData, index: number) => React.Key
  getRowClassName?: (row: TData, index: number) => string | undefined
  getSortableRowId?: (row: TData, index: number) => UniqueIdentifier | undefined
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
  cell?: (row: TData, index: number) => React.ReactNode
}

export function StaticDataTable<TData = unknown>(
  props: StaticDataTableProps<TData>
) {
  const { className, tableClassName, containerProps, tableProps } = props

  return (
    <>
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
      {props.columns !== undefined && props.getSortableRowId ? (
        <StaticDataTableDragOverlay {...props} />
      ) : null}
    </>
  )
}

function StaticDataTableWithColumns<TData>({
  columns,
  data,
  getRowKey,
  getRowClassName,
  getSortableRowId,
  getRowProps,
  renderRow,
  empty,
  emptyContent,
  emptyClassName,
  headerRowClassName,
}: StaticDataTableDataProps<TData>) {
  const isEmpty = empty ?? (data !== undefined && data.length === 0)
  const bodyRows = data.map((row, index) => (
    <StaticDataTableRow
      key={getRowKey?.(row, index) ?? index}
      row={row}
      index={index}
      columns={columns}
      getRowClassName={getRowClassName}
      getSortableRowId={getSortableRowId}
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
    </>
  )
}

type StaticDataTableRowProps<TData> = Required<
  Pick<StaticDataTableDataProps<TData>, 'columns'>
> &
  Pick<
    StaticDataTableDataProps<TData>,
    'getRowClassName' | 'getSortableRowId' | 'getRowProps' | 'renderRow'
  > & {
    row: TData
    index: number
  }

function StaticDataTableRow<TData>({
  row,
  index,
  columns,
  getRowClassName,
  getSortableRowId,
  getRowProps,
  renderRow,
}: StaticDataTableRowProps<TData>) {
  if (renderRow) {
    return <>{renderRow(row, index)}</>
  }

  const rowProps = getRowProps?.(row, index)
  const rowClassName = cn(rowProps?.className, getRowClassName?.(row, index))
  const rowContent = columns.map((column) => (
    <TableCell
      key={column.id}
      className={cn(
        'max-w-full min-w-0 overflow-hidden',
        getStaticCellClassName(column, row, index)
      )}
    >
      {renderStaticCellContent(column, row, index)}
    </TableCell>
  ))

  const sortableRowId = getSortableRowId?.(row, index)
  if (sortableRowId !== undefined) {
    return (
      <SortableStaticDataTableRow
        id={sortableRowId}
        rowProps={rowProps}
        className={rowClassName}
      >
        {rowContent}
      </SortableStaticDataTableRow>
    )
  }

  return (
    <TableRow {...rowProps} className={rowClassName}>
      {rowContent}
    </TableRow>
  )
}

type SortableRowContextValue = Pick<
  ReturnType<typeof useSortable>,
  'attributes' | 'listeners' | 'setActivatorNodeRef'
>

const SortableRowContext = React.createContext<SortableRowContextValue | null>(
  null
)

const sortableDropAnimation: DropAnimation = {
  duration: 220,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: {
        opacity: '0',
      },
    },
  }),
}
function SortableStaticDataTableRow(props: {
  id: UniqueIdentifier
  rowProps?: Omit<React.ComponentProps<typeof TableRow>, 'children'>
  className?: string
  children: React.ReactNode
}) {
  const sortable = useSortable({
    id: props.id,
    transition: {
      duration: 260,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
  })
  const cellTransform = CSS.Translate.toString(sortable.transform)
  const animatedCells = React.Children.map(props.children, (child) => {
    if (!React.isValidElement<React.ComponentProps<typeof TableCell>>(child)) {
      return child
    }

    return React.cloneElement(child, {
      className: cn(
        child.props.className,
        'bg-background group-hover:bg-muted/20 border-border relative border-b will-change-transform',
        sortable.isDragging && 'opacity-0'
      ),
      style: {
        ...child.props.style,
        transform: sortable.isDragging ? undefined : cellTransform,
        transition: sortable.transition,
      },
    })
  })

  return (
    <SortableRowContext.Provider value={sortable}>
      <TableRow
        {...props.rowProps}
        ref={sortable.setNodeRef}
        className={cn(
          props.className,
          'relative border-b-0 transition-[opacity,box-shadow]',
          sortable.isDragging && 'z-10'
        )}
        style={props.rowProps?.style}
      >
        {animatedCells}
      </TableRow>
    </SortableRowContext.Provider>
  )
}

function StaticDataTableDragOverlay<TData>(
  props: StaticDataTableDataProps<TData>
) {
  const dndContext = useDndContext()
  const activeIndex = props.data.findIndex(
    (row, index) =>
      props.getSortableRowId?.(row, index) === dndContext.active?.id
  )
  const activeRow = props.data[activeIndex]
  const activeNode = dndContext.activeNode
  const overlayModifiers = React.useMemo<Modifier[]>(() => {
    const restrictToTableBody: Modifier = ({ draggingNodeRect, transform }) => {
      const tableBodyRect = activeNode?.parentElement?.getBoundingClientRect()
      if (!draggingNodeRect || !tableBodyRect) return transform

      const nextTransform = { ...transform }
      if (draggingNodeRect.top + transform.y < tableBodyRect.top) {
        nextTransform.y = tableBodyRect.top - draggingNodeRect.top
      } else if (draggingNodeRect.bottom + transform.y > tableBodyRect.bottom) {
        nextTransform.y = tableBodyRect.bottom - draggingNodeRect.bottom
      }
      return nextTransform
    }

    return [restrictToVerticalAxis, restrictToTableBody]
  }, [activeNode])
  const cellWidths = activeNode
    ? Array.from(
        activeNode.children,
        (cell) => Math.round(cell.getBoundingClientRect().width * 100) / 100
      )
    : []

  const overlay = (
    <DragOverlay
      dropAnimation={sortableDropAnimation}
      modifiers={overlayModifiers}
      zIndex={60}
    >
      {activeRow ? (
        <div
          className='bg-background overflow-hidden rounded-md shadow-lg ring-1 ring-black/10'
          style={{ width: dndContext.activeNodeRect?.width }}
        >
          <table
            aria-hidden='true'
            className='w-full table-fixed caption-bottom text-sm tabular-nums'
          >
            <colgroup>
              {props.columns.map((column, index) => (
                <col key={column.id} style={{ width: cellWidths[index] }} />
              ))}
            </colgroup>
            <tbody>
              <TableRow className='bg-muted/90 hover:bg-muted/90 h-15 border-0'>
                {props.columns.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn(
                      'max-w-full min-w-0 overflow-hidden',
                      getStaticCellClassName(column, activeRow, activeIndex)
                    )}
                  >
                    {renderStaticCellContent(column, activeRow, activeIndex)}
                  </TableCell>
                ))}
              </TableRow>
            </tbody>
          </table>
        </div>
      ) : null}
    </DragOverlay>
  )

  return typeof document === 'undefined'
    ? null
    : createPortal(overlay, document.body)
}

export function StaticDataTableDragHandle(
  props: React.ComponentProps<'button'>
) {
  const sortable = React.useContext(SortableRowContext)

  return (
    <button
      type='button'
      ref={sortable?.setActivatorNodeRef}
      {...sortable?.attributes}
      {...sortable?.listeners}
      {...props}
      className={cn('touch-none select-none', props.className)}
    />
  )
}

function renderStaticCellContent<TData>(
  column: StaticDataTableColumn<TData>,
  row: TData,
  index: number
) {
  const content = column.cell?.(row, index)
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
