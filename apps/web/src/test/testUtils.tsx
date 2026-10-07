import React from "react";
import { MemoryRouter } from "react-router-dom";
import { render } from "@testing-library/react";

export function renderWithRouter(
  ui: React.ReactElement,
  opts?: { route?: string }
) {
  const route = opts?.route ?? "/";
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
}

