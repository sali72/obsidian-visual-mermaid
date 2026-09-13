/**
 * Canvas Overlays Manager
 * Composes dedicated overlay layers: Connection, MultiSelect, Node, Edge, Subgraph, and Inline Editing.
 * All layers consume the driver contract — no diagram-type branching here.
 */

import React from 'react';
import { CursorMode, SelectionBox } from '../types';
import { useCanvasSelection } from '../hooks/useCanvasSelection';
import { useDiagramMutations } from '../hooks/useDiagramMutations';
import { useInlineEditing } from '../hooks/useInlineEditing';
import { useCanvasMouseInteractions } from '../hooks/useCanvasMouseInteractions';

import { ConnectionLine } from './ConnectionLine';
import { SelectionMarquee } from './SelectionMarquee';
import { ConnectionHintPill } from './ConnectionHintPill';
import { NodeOverlays } from '../overlays/NodeOverlays';
import { EdgeOverlays } from '../overlays/EdgeOverlays';
import { SubgraphOverlays } from '../overlays/SubgraphOverlays';
import { MultiSelectOverlays } from '../overlays/MultiSelectOverlays';
import { InlineEditOverlays } from '../overlays/InlineEditOverlays';

export interface CanvasOverlaysProps {
  mouse: ReturnType<typeof useCanvasMouseInteractions>;
  marquee: { selectionBox: SelectionBox | null };
  selection: ReturnType<typeof useCanvasSelection>;
  mutations: ReturnType<typeof useDiagramMutations>;
  inlineEditing: ReturnType<typeof useInlineEditing>;
  cursorMode: CursorMode;
  isSpacePressed: boolean;
  canRenameSelectedNode?: boolean;
  svgMountRef: React.RefObject<HTMLDivElement>;
  handleStartEditingNode: (nodeId: string, nodeEl: Element) => void;
}

export const CanvasOverlays: React.FC<CanvasOverlaysProps> = ({
  mouse,
  marquee,
  selection,
  mutations,
  inlineEditing,
  cursorMode,
  isSpacePressed,
  canRenameSelectedNode,
  svgMountRef,
  handleStartEditingNode,
}) => {
  const { selectedNodeId, selectedEdgeId, selectedSubgraphId } = selection;
  const driver = mutations.driver;

  const canUngroup = Array.from(selection.selectedNodeIds).some(
    (nid) => !!mutations.displayNodes.get(nid)?.subgraphId
  );

  const selectedNodeStyle = selectedNodeId
    ? mutations.displayNodes.get(selectedNodeId)?.style
    : undefined;

  const selectedEdgeStyle = selectedEdgeId
    ? mutations.displayEdges.find((e) => e.id === selectedEdgeId)?.style
    : undefined;

  const selectedSubgraphStyle = selectedSubgraphId
    ? mutations.displaySubgraphs.get(selectedSubgraphId)?.style
    : undefined;

  return (
    <div className="mermaid-native-overlay">
      {/* Connection Dragging SVG Line */}
      <ConnectionLine dragLine={mouse.dragLine} />

      {/* Marquee Drag Selection Box */}
      <SelectionMarquee box={marquee.selectionBox} />

      {/* Node Drag-to-Connect Hint Pill */}
      <ConnectionHintPill
        hoveredNodeRect={mouse.hoveredNodeRect}
        hoveredNodeId={mouse.hoveredNodeId}
        hoveredNodeKind={mouse.hoveredNodeKind}
        isLR={selection.isLR}
        cursorMode={cursorMode}
        isSpacePressed={isSpacePressed}
        isConnecting={!!mouse.connectingSourceId}
        isEditing={!!inlineEditing.editingNodeId}
        isMultiSelect={selection.isMultiSelect}
        isAnchor={driver.mutations.anchors?.isAnchor}
      />

      {/* Multi-Select Layer */}
      <MultiSelectOverlays
        multiSelectBounds={selection.multiSelectBounds}
        isMultiSelect={selection.isMultiSelect}
        driver={driver}
        selectedNodeIds={selection.selectedNodeIds}
        selectedEdgeIds={selection.selectedEdgeIds}
        activeMultiPopover={selection.activeMultiPopover}
        onToggleMultiPopover={(popover) =>
          selection.setActiveMultiPopover((prev) => (prev === popover ? null : popover))
        }
        onBatchDelete={mutations.handleBatchDeleteSelected}
        onBatchGroup={mutations.handleBatchGroupSelected}
        canUngroup={canUngroup}
        onBatchUngroup={mutations.handleBatchUngroupSelected}
        popoverPos={selection.popoverPos}
        onBatchUpdateEdgeType={mutations.handleBatchUpdateEdgeType}
        viewNodes={mutations.displayNodes}
        onBatchSelectNodeKind={mutations.handleBatchUpdateNodeKind}
        onApplyPreset={mutations.handleBatchApplyThemePreset}
        onUpdateCustomStyle={mutations.handleBatchUpdateCustomStyle}
        onClearStyle={mutations.handleBatchClearStyle}
      />

      {/* Single Node Layer */}
      <NodeOverlays
        selectedNodeRect={selection.selectedNodeRect}
        selectedNodeId={selectedNodeId}
        isMultiSelect={selection.isMultiSelect}
        sproutX={selection.sproutX}
        sproutY={selection.sproutY}
        isLR={selection.isLR}
        driver={driver}
        viewNodes={mutations.displayNodes}
        currentNode={selectedNodeId ? mutations.displayNodes.get(selectedNodeId) : undefined}
        currentStyle={selectedNodeStyle}
        activeNodePopover={selection.activeNodePopover}
        onSproutNextStep={mutations.handleSproutNextStep}
        onStartEditingNode={(nodeId) => {
          const el =
            svgMountRef.current?.querySelector(
              `rect.actor-top[name="${nodeId}"], g.actor-top[name="${nodeId}"], [data-mermaid-node-id="${nodeId}"]:not(.actor-line):not(.mermaid-lifeline-hit-area)`
            ) || svgMountRef.current?.querySelector(`[data-mermaid-node-id="${nodeId}"]`);
          if (el) handleStartEditingNode(nodeId, el);
        }}
        onToggleNodePopover={(popover) =>
          selection.setActiveNodePopover((prev) => (prev === popover ? null : popover))
        }
        onDeleteNode={mutations.handleDeleteSelectedNode}
        canRenameNode={canRenameSelectedNode}
        popoverPos={selection.popoverPos}
        onSelectNodeKind={mutations.handleUpdateNodeKind}
        onApplyNodePreset={mutations.handleApplyNodePreset}
        onUpdateCustomStyle={mutations.handleUpdateCustomStyle}
        onClearNodeStyle={mutations.handleClearNodeStyle}
        currentSubgraphId={
          selectedNodeId ? mutations.displayNodes.get(selectedNodeId)?.subgraphId : undefined
        }
        displaySubgraphs={mutations.displaySubgraphs}
        onSelectSubgraphMembership={(subId) => {
          if (selectedNodeId) {
            mutations.handleMoveNodeToSubgraph(selectedNodeId, subId);
          }
          selection.setActiveNodePopover(null);
        }}
        onCreateNewGroupMembership={() => {
          if (selectedNodeId) {
            mutations.handleCreateGroupWithNode(selectedNodeId);
          }
          selection.setActiveNodePopover(null);
        }}
        onRemoveNodeFromGroup={(nodeId) => {
          mutations.handleRemoveNodeFromGroup(nodeId);
        }}
        onCloseSubgraphMembership={() => selection.setActiveNodePopover(null)}
      />

      {/* Single Edge Layer */}
      <EdgeOverlays
        selectedEdgePos={selection.selectedEdgePos}
        selectedEdgeId={selectedEdgeId}
        isMultiSelect={selection.isMultiSelect}
        driver={driver}
        selectedEdgeStyle={selectedEdgeStyle}
        activeEdgePopover={selection.activeEdgePopover}
        onChangeEdgeType={mutations.handleChangeEdgeType}
        onReverseEdge={mutations.handleReverseEdge}
        onInsertNodeOnEdge={mutations.handleInsertNodeOnEdge}
        onUpdateEdgeLabel={mutations.handleUpdateEdgeLabel}
        onToggleEdgeStyle={() =>
          selection.setActiveEdgePopover((prev) => (prev === 'style' ? null : 'style'))
        }
        onDeleteEdge={mutations.handleDeleteSelectedEdge}
        onApplyEdgePreset={mutations.handleApplyEdgePreset}
        onUpdateEdgeCustomStyle={mutations.handleUpdateEdgeCustomStyle}
        onClearEdgeStyle={mutations.handleClearEdgeStyle}
      />

      {/* Subgraph Layer */}
      <SubgraphOverlays
        selectedSubgraphRect={selection.selectedSubgraphRect}
        selectedSubgraphId={selectedSubgraphId}
        isMultiSelect={selection.isMultiSelect}
        displaySubgraphs={mutations.displaySubgraphs}
        selectedSubgraphStyle={selectedSubgraphStyle}
        activeSubgraphPopover={selection.activeSubgraphPopover}
        onToggleSubgraphStyle={() =>
          selection.setActiveSubgraphPopover((prev) => (prev === 'style' ? null : 'style'))
        }
        onToggleSubgraphGroup={() =>
          selection.setActiveSubgraphPopover((prev) => (prev === 'group' ? null : 'group'))
        }
        onStartEditingSubgraph={(subId) => {
          const subEl = svgMountRef.current?.querySelector(`[data-mermaid-subgraph-id="${subId}"]`);
          if (subEl) {
            inlineEditing.startEditingSubgraph(subId, subEl);
          } else if (selection.selectedSubgraphRect && svgMountRef.current) {
            inlineEditing.startEditingSubgraph(subId, svgMountRef.current);
          }
        }}
        onDissolveSubgraph={mutations.handleDissolveSubgraph}
        onDeleteSubgraphAll={mutations.handleDeleteSubgraphAll}
        subgraphPopoverPos={selection.subgraphPopoverPos}
        onApplySubgraphPreset={mutations.handleApplySubgraphPreset}
        onUpdateSubgraphCustomStyle={mutations.handleUpdateSubgraphCustomStyle}
        onClearSubgraphStyle={mutations.handleClearSubgraphStyle}
        unmatchedSubgraphIds={selection.unmatchedSubgraphIds}
        onSelectUnmatchedSubgraph={(subId, idx) => {
          selection.isolateSelection('subgraph', subId);
          selection.setSelectedSubgraphRect({
            x: 24,
            y: 52 + idx * 4,
            width: 200,
            height: 30,
          });
        }}
        onMoveSubgraphToGroup={(subId, targetId) => {
          mutations.handleMoveNodeToSubgraph(subId, targetId);
          selection.setActiveSubgraphPopover(null);
        }}
        onCreateParentGroupWithSubgraph={(subId) => {
          mutations.handleCreateGroupWithNode(subId);
          selection.setActiveSubgraphPopover(null);
        }}
        onCloseSubgraphPopover={() => selection.setActiveSubgraphPopover(null)}
        canAddStart={
          selectedSubgraphId && driver.mutations.anchors
            ? !driver.mutations.anchors.has(mutations.ast, 'start', selectedSubgraphId)
            : false
        }
        canAddEnd={
          selectedSubgraphId && driver.mutations.anchors
            ? !driver.mutations.anchors.has(mutations.ast, 'end', selectedSubgraphId)
            : false
        }
        onAddStart={
          selectedSubgraphId && driver.capabilities.hasAnchors
            ? () => mutations.handleAddStartState(selectedSubgraphId)
            : undefined
        }
        onAddEnd={
          selectedSubgraphId && driver.capabilities.hasAnchors
            ? () => mutations.handleAddEndState(selectedSubgraphId)
            : undefined
        }
      />

      {/* Inline Text Editors Layer */}
      <InlineEditOverlays
        editingNodeId={inlineEditing.editingNodeId}
        editingPos={inlineEditing.editingPos}
        editNodeLabel={inlineEditing.editNodeLabel}
        onEditNodeLabelChange={inlineEditing.setEditNodeLabel}
        onFinishEditingNode={inlineEditing.handleFinishEditingNode}
        onCancelEditingNode={inlineEditing.cancelEditingNode}
        editingEdgeId={inlineEditing.editingEdgeId}
        editingEdgePos={inlineEditing.editingEdgePos}
        editEdgeLabel={inlineEditing.editEdgeLabel}
        onEditEdgeLabelChange={inlineEditing.setEditEdgeLabel}
        onFinishEditingEdge={inlineEditing.handleFinishEditingEdge}
        onCancelEditingEdge={inlineEditing.cancelEditingEdge}
        editingSubgraphId={inlineEditing.editingSubgraphId}
        editingSubgraphPos={inlineEditing.editingSubgraphPos}
        editSubgraphLabel={inlineEditing.editSubgraphLabel}
        onEditSubgraphLabelChange={inlineEditing.setEditSubgraphLabel}
        onFinishEditingSubgraph={inlineEditing.handleFinishEditingSubgraph}
        onCancelEditingSubgraph={inlineEditing.cancelEditingSubgraph}
      />
    </div>
  );
};
