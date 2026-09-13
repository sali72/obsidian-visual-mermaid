/**
 * Overlays for Selected Nodes: HUD, Kind Popover, Node Style Popover, Group Membership.
 */

import React from 'react';
import { ActiveNodePopover, PopoverPos, Rect } from '../types';
import { ThemePreset } from '../constants';
import { MermaidNodeDef, MermaidSubgraphDef } from '../../diagrams/viewModel';
import { DiagramDriver } from '../../diagrams/types';
import { NodeActionHud } from '../components/NodeActionHud';
import { KindPopover } from '../components/KindPopover';
import { NodeStylePopover } from '../components/NodeStylePopover';
import { SubgraphPopover } from '../components/SubgraphPopover';

export interface NodeOverlaysProps {
  selectedNodeRect: Rect | null;
  selectedNodeId: string | null;
  isMultiSelect: boolean;
  sproutX: number;
  sproutY: number;
  isLR: boolean;
  driver: DiagramDriver;
  viewNodes: Map<string, MermaidNodeDef>;
  currentNode: MermaidNodeDef | undefined;
  currentStyle: Record<string, string> | undefined;
  activeNodePopover: ActiveNodePopover;
  onSproutNextStep: (nodeId: string) => void;
  onStartEditingNode: (nodeId: string) => void;
  onToggleNodePopover: (popover: 'shape' | 'style' | 'subgraph') => void;
  onDeleteNode: () => void;
  canRenameNode?: boolean;

  popoverPos: PopoverPos | null;
  onSelectNodeKind: (kind: string) => void;
  onApplyNodePreset: (preset: ThemePreset) => void;
  onUpdateCustomStyle: (prop: string, val: string) => void;
  onClearNodeStyle: () => void;

  currentSubgraphId: string | undefined;
  displaySubgraphs: Map<string, MermaidSubgraphDef>;
  onSelectSubgraphMembership: (subId: string | null) => void;
  onCreateNewGroupMembership: () => void;
  onRemoveNodeFromGroup?: (nodeId: string) => void;
  onCloseSubgraphMembership: () => void;
}

export const NodeOverlays: React.FC<NodeOverlaysProps> = ({
  selectedNodeRect,
  selectedNodeId,
  isMultiSelect,
  sproutX,
  sproutY,
  isLR,
  driver,
  viewNodes,
  currentNode,
  currentStyle,
  activeNodePopover,
  onSproutNextStep,
  onStartEditingNode,
  onToggleNodePopover,
  onDeleteNode,
  canRenameNode,
  popoverPos,
  onSelectNodeKind,
  onApplyNodePreset,
  onUpdateCustomStyle,
  onClearNodeStyle,
  currentSubgraphId,
  displaySubgraphs,
  onSelectSubgraphMembership,
  onCreateNewGroupMembership,
  onRemoveNodeFromGroup,
  onCloseSubgraphMembership,
}) => {
  return (
    <>
      {/* Single Node Relational Sprout HUD */}
      {selectedNodeRect && selectedNodeId && !isMultiSelect && (
        <NodeActionHud
          selectedNodeId={selectedNodeId}
          sproutX={sproutX}
          sproutY={sproutY}
          isLR={isLR}
          driver={driver}
          currentNode={currentNode}
          currentStyle={currentStyle}
          activeNodePopover={activeNodePopover}
          onSproutNextStep={() => onSproutNextStep(selectedNodeId)}
          onRename={() => onStartEditingNode(selectedNodeId)}
          onTogglePopover={onToggleNodePopover}
          onRemoveFromGroup={
            onRemoveNodeFromGroup
              ? () => onRemoveNodeFromGroup(selectedNodeId)
              : undefined
          }
          onDelete={onDeleteNode}
          canRename={canRenameNode}
          hideSprout={
            !!driver.mutations.anchors?.isAnchor(selectedNodeId)
          }
          hideDelete={false}
        />
      )}

      {/* Kind Popover (shapes / state types) */}
      {activeNodePopover === 'shape' &&
        driver.capabilities.supportsNodeKinds &&
        popoverPos && (
          <KindPopover
            popoverPos={popoverPos}
            options={driver.nodeKindOptions}
            title={`${driver.labels.node} Kind`}
            selectedNodeId={selectedNodeId}
            selectedNodeIds={new Set(selectedNodeId ? [selectedNodeId] : [])}
            viewNodes={viewNodes}
            onSelectKind={onSelectNodeKind}
          />
        )}

      {/* Visual Styling Popover for single node */}
      {activeNodePopover === 'style' && popoverPos && (
        <NodeStylePopover
          popoverPos={popoverPos}
          currentStyle={currentStyle}
          onApplyPreset={onApplyNodePreset}
          onUpdateCustomStyle={onUpdateCustomStyle}
          onClearStyle={onClearNodeStyle}
        />
      )}

      {/* Group Membership Popover */}
      {activeNodePopover === 'subgraph' && popoverPos && selectedNodeId && (
        <div
          style={{
            position: 'absolute',
            left: popoverPos.left,
            top: popoverPos.top,
            transform: popoverPos.transform,
            zIndex: 200,
          }}
        >
          <SubgraphPopover
            currentSubgraphId={currentSubgraphId}
            subgraphs={Array.from(displaySubgraphs.values())}
            onSelectSubgraph={onSelectSubgraphMembership}
            onCreateNewGroup={onCreateNewGroupMembership}
            onClose={onCloseSubgraphMembership}
          />
        </div>
      )}
    </>
  );
};
