import { DataTable, type DataTableColumn } from "../data-table";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

interface Person {
  id: string;
  name: string;
  age: number;
}

const data: Person[] = [
  { id: "1", name: "Alice", age: 30 },
  { id: "2", name: "Bob", age: 25 },
  { id: "3", name: "Carol", age: 40 },
];

const columns: DataTableColumn<Person>[] = [
  { key: "name", header: "Name", accessorKey: "name" },
  { key: "age", header: "Age", cell: (row) => <span>{row.age} yrs</span> },
];

describe("DataTable", () => {
  it("renders a column's accessorKey value and a column's custom cell render", () => {
    render(<DataTable columns={columns} data={data} getRowKey={(row) => row.id} />);
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Age" })).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("30 yrs")).toBeInTheDocument();
  });

  it("gives the header row a bg-muted background", () => {
    render(<DataTable columns={columns} data={data} getRowKey={(row) => row.id} />);
    const headerRow = screen.getAllByRole("row")[0];
    expect(headerRow.className).toContain("bg-muted");
  });

  it("stripes even-indexed body rows with bg-muted/40 and leaves odd rows transparent", () => {
    render(<DataTable columns={columns} data={data} getRowKey={(row) => row.id} />);
    const rows = screen.getAllByRole("row");
    const [, aliceRow, bobRow, carolRow] = rows;
    expect(aliceRow.className).not.toContain("bg-muted/40");
    expect(bobRow.className).toContain("bg-muted/40");
    expect(carolRow.className).not.toContain("bg-muted/40");
  });

  it("composes rowClassName alongside the stripe class instead of replacing it", () => {
    render(<DataTable columns={columns} data={data} getRowKey={(row) => row.id} rowClassName={(row) => (row.id === "2" ? "ring-2" : undefined)} />);
    const rows = screen.getAllByRole("row");
    const bobRow = rows[2];
    expect(bobRow.className).toContain("bg-muted/40");
    expect(bobRow.className).toContain("ring-2");
  });
});
