import { InternationalizePage } from "../InternationalizePage";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MockAdapter from "axios-mock-adapter";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { api } from "@/lib/api";
import { renderWithProviders } from "@/test-utils";

let mock: MockAdapter;

const localesResponse = [
  { code: "en", name: "English", isDefault: true },
  { code: "vi", name: "Vietnamese", isDefault: false },
];

beforeEach(() => {
  mock = new MockAdapter(api);
  mock.onGet("/api/locales").reply(200, localesResponse);
});

afterEach(() => {
  mock.restore();
});

describe("InternationalizePage", () => {
  it("renders the locale table", async () => {
    renderWithProviders(<InternationalizePage />);
    await waitFor(() => {
      expect(screen.getByText("English")).toBeInTheDocument();
      expect(screen.getByText("Vietnamese")).toBeInTheDocument();
    });
  });

  it("opens the add-locale dialog with an accessible title and description", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InternationalizePage />);
    await waitFor(() => screen.getByText("English"));

    await user.click(screen.getByText("Add locale"));

    expect(screen.getByRole("heading", { name: "Add locale" })).toBeInTheDocument();
    expect(screen.getByText("Add a new locale for your content.")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")?.split(" ")).toHaveLength(1);
  });

  it("closes the dialog on Cancel", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InternationalizePage />);
    await waitFor(() => screen.getByText("English"));

    await user.click(screen.getByText("Add locale"));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("submits a new locale on Create", async () => {
    mock.onPost("/api/locales").reply(201, { code: "fr", name: "French", isDefault: false });
    const user = userEvent.setup();
    renderWithProviders(<InternationalizePage />);
    await waitFor(() => screen.getByText("English"));

    await user.click(screen.getByText("Add locale"));
    await user.type(screen.getByLabelText("Code"), "fr");
    await user.type(screen.getByLabelText("Name"), "French");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ code: "fr", name: "French", isDefault: false });
  });

  it("opens the edit dialog pre-filled, with the code locked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InternationalizePage />);
    await waitFor(() => screen.getByText("English"));

    const englishRow = screen.getByText("English").closest("tr") as HTMLElement;
    await user.click(within(englishRow).getByLabelText("Edit"));

    expect(screen.getByRole("heading", { name: "Edit locale" })).toBeInTheDocument();
    expect(screen.getByText("Update this locale's name and default status.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("en")).toBeDisabled();
    expect(screen.getByDisplayValue("English")).toBeInTheDocument();
  });
});
