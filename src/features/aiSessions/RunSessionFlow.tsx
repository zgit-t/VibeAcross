import { useEffect, useMemo, useState } from "react";
import { useTools } from "../../context/ToolsContext";
import { RunSessionDialog } from "./RunSessionDialog";
import type { Project } from "../../types/domain";

interface RunSessionFlowProps {
  open: boolean;
  project: Project | null;
  /** 打开时优选的工具安装 id（通常是「当前运行工具」或默认工具）。 */
  initialToolId?: string | null;
  onClose: () => void;
  /** 用户切换运行工具时回调（用于记住当前运行工具）。 */
  onToolChange?: (toolId: string) => void;
}

/**
 * 运行会话流程编排。
 *
 * 工具列表直接取自统一的检测结果（`ToolsContext` 中已识别/已检测到的工具），
 * 与「项目是否关联过该工具」「用户是否手动切换过工具」无关，因此打开即可看到
 * 当前最新、完整的工具列表；检测仍在进行时如实展示加载状态，绝不在列表短暂
 * 为空时就认定「没有工具」。
 *
 * 点击运行后直接进入会话界面：默认展示当前项目 + 当前工具的历史会话，并在同一
 * 界面提供「新建会话」。关闭 / 取消一律不启动工具、不创建也不恢复任何会话。
 */
export function RunSessionFlow({
  open,
  project,
  initialToolId,
  onClose,
  onToolChange,
}: RunSessionFlowProps) {
  const { tools: allTools, loading: toolsLoading, detecting } = useTools();

  const projectId = project?.id ?? null;
  const [toolId, setToolId] = useState<string | null>(null);

  // 每次打开（或切换项目）都清空记住的工具选择。
  useEffect(() => {
    if (!open) {
      return;
    }
    setToolId(null);
  }, [open, projectId]);

  // 统一的检测结果：当前已识别（已检测到）的工具。不再依赖项目关联或手动切换。
  const detectedTools = useMemo(
    () => allTools.filter((tool) => tool.installed),
    [allTools],
  );

  // 当前运行工具：记住的选择 → 传入的初始工具 → 第一个已识别工具。
  const currentTool = useMemo(() => {
    const pick = (id: string | null | undefined) =>
      id ? detectedTools.find((tool) => tool.id === id) ?? null : null;
    return pick(toolId) ?? pick(initialToolId) ?? detectedTools[0] ?? null;
  }, [detectedTools, toolId, initialToolId]);

  if (!open || !project) {
    return null;
  }

  return (
    <RunSessionDialog
      open
      project={project}
      tools={detectedTools}
      toolsLoading={toolsLoading || detecting}
      initialToolId={currentTool?.id ?? null}
      onClose={onClose}
      onToolChange={(id) => {
        setToolId(id);
        onToolChange?.(id);
      }}
    />
  );
}
