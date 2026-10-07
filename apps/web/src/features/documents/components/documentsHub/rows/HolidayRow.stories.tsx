/**
 * Storybook stories for HolidayRow component
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { HolidayRowGlobal } from "./HolidayRow";

const meta: Meta<typeof HolidayRowGlobal> = {
  title: "DocumentsHub/Rows/HolidayRow",
  component: HolidayRowGlobal,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof HolidayRowGlobal>;

export const NewYearsDay: Story = {
  args: {
    h: {
      name: "New Year's Day",
      dateKey: "2024-01-01",
    },
  },
};

export const IndependenceDay: Story = {
  args: {
    h: {
      name: "Independence Day",
      dateKey: "2024-07-04",
    },
  },
};

export const Christmas: Story = {
  args: {
    h: {
      name: "Christmas Day",
      dateKey: "2024-12-25",
    },
  },
};

export const WithDateMs: Story = {
  args: {
    h: {
      name: "Thanksgiving",
      dateMs: new Date(2024, 10, 28).getTime(),
    },
  },
};

export const WithTitle: Story = {
  args: {
    h: {
      title: "Labor Day",
      dateKey: "2024-09-02",
    },
  },
};

export const CompactDensity: Story = {
  args: {
    h: {
      name: "Memorial Day",
      dateKey: "2024-05-27",
    },
    ...({ density: "compact" } as any),
  },
};

export const ComfortableDensity: Story = {
  args: {
    h: {
      name: "Veterans Day",
      dateKey: "2024-11-11",
    },
    ...({ density: "comfortable" } as any),
  },
};

