import React from 'react';
import { MermaidNodeDef } from '../../diagrams/viewModel';
import { ActiveNodePopover } from '../types';
import {
  PlusIcon,
  PencilIcon,
  PaletteIcon,
  FolderIcon,
  TrashIcon,
  UngroupIcon,
  ShapeIcons,
  StateTypeIcons,
  UserIcon,
} from '../icons/Icons';

import { DiagramDriver } from '../../diagrams/types';

type KindIcon = React.FC<{ size?: number }>;

function kindIcon(kind: string | undefined): KindIcon {
  if (kind === 'actor') return UserIcon;
  const shapes = ShapeIcons as Record<string, KindIcon>;
  const stateTypes = StateTypeIcons as Record<string, KindIcon>;
  const key = kind || 'rectangle';
  return shapes[key] || stateTypes[key] || ShapeIcons.rectangle;
}

export interface NodeActionHudProps {
  selectedNodeId: string;
  sproutX: number;
  sproutY: number;
  isLR: boolean;
  driver: DiagramDriver;
  currentNode: MermaidNodeDef | undefined;
  currentStyle: Record<string, string> | undefined;
  activeNodePopover: ActiveNodePopover;
  onSproutNextStep: () => void;
  onRename: () => void;
  onTogglePopover: (popover: 'shape' | 'style' | 'subgraph') => void;
  onRemoveFromGroup?: () => void;
  onDelete: () => void;
  canRename?: boolean;
  hideSprout?: boolean;
  hideDelete?: boolean;
}

export const NodeActionHud: React.FC<NodeActionHudProps> = ({
  selectedNodeId,
  sproutX,
  sproutY,
  isLR,
  driver,
  currentNode,
  currentStyle,
  activeNodePopover,
  onSproutNextStep,
  onRename,
  onTogglePopover,
  onRemoveFromGroup,
  onDelete,
  canRename,
  hideSprout = false,
  hideDelete = false,
}) => {
  const { labels, capabilities } = driver;
  const isAnchor = !!driver.mutations.anchors?.isAnchor(selectedNodeId);
  const supportsKinds = capabilities.supportsNodeKinds && driver.nodeKindOptions.length > 0;
  const ShapeComp = kindIcon(currentNode?.kind || currentNode?.shape);

  return (
    <div
      className="mermaid-action-hud nodrag"
      style={{
        position: 'absolute',
        left: sproutX,
        top: sproutY,
        transform: isLR ? 'translate(0, -50%)' : 'translate(-50%, 0)',
        zIndex: 150,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {!hideSprout && (
        <button
          type="button"
          className="mermaid-hud-btn sprout-btn"
          onClick={onSproutNextStep}
          title={`Sprout ${labels.addChild} (creates connected child)`}
        >
          <PlusIcon size={13} />
          <span>{labels.addChild}</span>
        </button>
      )}

      {/* Rename Button (only nodes that carry text) */}
      {(canRename ?? !isAnchor) && (
        <button
          type="button"
          className="mermaid-hud-btn icon-only"
          onClick={onRename}
          title={`Rename ${labels.node}`}
        >
          <PencilIcon size={13} />
        </button>
      )}

      {/* Kind Picker Button (shapes / state types; hidden for anchors) */}
      {supportsKinds && !isAnchor && (
        <button
          type="button"
          className={`mermaid-hud-btn icon-only ${
            activeNodePopover === 'shape' ? 'is-active' : ''
          }`}
          onClick={() => onTogglePopover('shape')}
          title={`Change ${labels.node} Kind`}
        >
          <ShapeComp size={14} />
        </button>
      )}

      {/* Visual Style & Color Button (hidden for anchors) */}
      {!isAnchor && (
        <button
          type="button"
          className={`mermaid-hud-btn icon-only ${
            activeNodePopover === 'style' ? 'is-active' : ''
          }`}
          onClick={() => onTogglePopover('style')}
          title="Colors & Border Style"
        >
          <PaletteIcon size={14} />
          {currentStyle?.fill && (
            <span
              className="mermaid-hud-color-indicator"
              style={{ backgroundColor: currentStyle.fill }}
            />
          )}
        </button>
      )}

      {/* Group Assignment Button (hidden for anchors) */}
      {capabilities.supportsGroups && !isAnchor && (
        <button
          type="button"
          className={`mermaid-hud-btn icon-only ${
            activeNodePopover === 'subgraph' ? 'is-active' : ''
          }`}
          onClick={() => onTogglePopover('subgraph')}
          title={
            currentNode?.subgraphId
              ? `${labels.group}: ${currentNode.subgraphId} (Click to change)`
              : `Assign to ${labels.group}`
          }
        >
          <FolderIcon size={14} />
        </button>
      )}

      {/* Remove From Group Button (only when the node is grouped) */}
      {capabilities.supportsGroups &&
        !isAnchor &&
        currentNode?.subgraphId &&
        onRemoveFromGroup && (
          <button
            type="button"
            className="mermaid-hud-btn icon-only"
            onClick={onRemoveFromGroup}
            title={`Remove from parent ${labels.group} (Keep ${labels.node})`}
          >
            <UngroupIcon size={14} />
          </button>
        )}

      {!hideDelete && (
        <>
          <div className="mermaid-hud-divider" />

          <button
            type="button"
            className="mermaid-hud-btn delete-btn icon-only"
            onClick={onDelete}
            title={`Delete ${labels.node} (and ${labels.edges.toLowerCase()})`}
          >
            <TrashIcon size={13} />
          </button>
        </>
      )}
    </div>
  );
};
