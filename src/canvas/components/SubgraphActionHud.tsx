import React from 'react';
import { MermaidSubgraphDef } from '../../diagrams/viewModel';
import { PencilIcon, PaletteIcon, TrashIcon, UngroupIcon, FolderIcon } from '../icons/Icons';

export interface SubgraphActionHudProps {
  subgraph: MermaidSubgraphDef;
  centerX: number;
  topY: number;
  currentStyle: Record<string, string> | undefined;
  isStyleActive: boolean;
  isGroupActive?: boolean;
  onToggleStyle: () => void;
  onToggleGroup?: () => void;
  onRename: () => void;
  onDissolve: () => void;
  onDeleteAll: () => void;
  canAddStart?: boolean;
  canAddEnd?: boolean;
  onAddStart?: () => void;
  onAddEnd?: () => void;
}

export const SubgraphActionHud: React.FC<SubgraphActionHudProps> = ({
  subgraph,
  centerX,
  topY,
  currentStyle,
  isStyleActive,
  isGroupActive,
  onToggleStyle,
  onToggleGroup,
  onRename,
  onDissolve,
  onDeleteAll,
  canAddStart,
  canAddEnd,
  onAddStart,
  onAddEnd,
}) => {
  return (
    <div
      className="mermaid-subgraph-hud nodrag"
      style={{
        position: 'absolute',
        left: centerX,
        top: topY - 12,
        transform: 'translate(-50%, -100%)',
        zIndex: 150,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mermaid-subgraph-badge" title={`Subgraph: ${subgraph.id}`}>
        <span>{subgraph.label || subgraph.id}</span>
      </div>

      <button
        type="button"
        className="mermaid-hud-btn icon-only"
        onClick={onRename}
        title="Rename Group"
      >
        <PencilIcon size={13} />
      </button>

      <button
        type="button"
        className={`mermaid-hud-btn icon-only ${isStyleActive ? 'is-active' : ''}`}
        onClick={onToggleStyle}
        title="Group Colors & Border Style"
      >
        <PaletteIcon size={14} />
        {currentStyle?.fill && (
          <span
            className="mermaid-hud-color-indicator"
            style={{ backgroundColor: currentStyle.fill }}
          />
        )}
      </button>

      {onToggleGroup && (
        <button
          type="button"
          className={`mermaid-hud-btn icon-only ${isGroupActive ? 'is-active' : ''}`}
          onClick={onToggleGroup}
          title="Nest into Group / Group Membership"
        >
          <FolderIcon size={14} />
        </button>
      )}

      <button
        type="button"
        className="mermaid-hud-btn icon-only"
        onClick={onDissolve}
        title="Dissolve Group (keep inner steps)"
      >
        <UngroupIcon size={14} />
      </button>

      {onAddStart && (
        <button
          type="button"
          className="mermaid-hud-btn"
          onClick={onAddStart}
          disabled={!canAddStart}
          title={canAddStart ? 'Add Start point ([*]) to Composite' : 'Composite start point already exists'}
        >
          <span>＋Start</span>
        </button>
      )}

      {onAddEnd && (
        <button
          type="button"
          className="mermaid-hud-btn"
          onClick={onAddEnd}
          disabled={!canAddEnd}
          title={canAddEnd ? 'Add End point ([*]) to Composite' : 'Composite end point already exists'}
        >
          <span>＋End</span>
        </button>
      )}

      <div className="mermaid-hud-divider" />

      <button
        type="button"
        className="mermaid-hud-btn delete-btn icon-only"
        onClick={onDeleteAll}
        title="Delete Group & inner steps"
      >
        <TrashIcon size={13} />
      </button>
    </div>
  );
};
