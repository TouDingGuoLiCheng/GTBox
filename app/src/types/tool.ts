export type ToolCategory = string;

export interface ToolParam {
  name: string;
  label: string;
  type: "string" | "number" | "boolean" | "file" | "folder" | "select";
  default?: unknown;
  flag?: string;
  options?: string[];
}

export interface ToolItem {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  tags?: string[];
  params?: ToolParam[];
  /** 专用路由；不设则走通用详情页 */
  customRoute?: string;
}
