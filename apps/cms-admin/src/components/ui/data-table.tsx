import * as React from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface DataTableColumn<T> {
  key?: string;
  header: React.ReactNode;
  accessorKey?: keyof T;
  cell?: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  getRowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
}

function DataTable<T>({ columns, data, getRowKey, rowClassName }: DataTableProps<T>) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-muted">
          {columns.map((column) => (
            <TableHead key={column.key ?? String(column.accessorKey)} className={column.className}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, index) => (
          <TableRow key={getRowKey(row)} className={cn(index % 2 === 1 && "bg-muted/40", rowClassName?.(row))}>
            {columns.map((column) => (
              <TableCell key={column.key ?? String(column.accessorKey)} className={column.className}>
                {column.cell ? column.cell(row) : column.accessorKey ? String(row[column.accessorKey]) : null}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export { DataTable };
export type { DataTableColumn, DataTableProps };
