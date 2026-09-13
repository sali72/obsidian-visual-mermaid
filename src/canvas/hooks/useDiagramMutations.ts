/**
 * Diagram Mutations Coordinator Hook
 *
 * Coordinates diagram AST mutations across nodes, edges, subgraphs/groups,
 * batch multi-selections, and clipboard operations.
 *
 * Decoupled from React prop-drilling by directly reading and updating
 * the centralized `useCanvasStore`.
 */

import { useCallback, useRef } from 'react';
import { useCanvasStore } from '../store/canvasStore';
import { useDiagramAst } from './mutations/useDiagramAst';
import { EdgeThemePreset, ThemePreset } from '../constants';
import { ArrowType } from '../../diagrams/viewModel';

export interface UseDiagramMutationsOptions {
  astHook: ReturnType<typeof useDiagramAst>;
  updateSelectedNodeHalo?: (targets?: string | null | Set<string> | string[]) => void;
  updateSelectedEdgeHalo?: (targets?: string | null | Set<string> | string[]) => void;
  // Backward compatibility: allow any legacy options to be passed without error
  [key: string]: unknown;
}

export function useDiagramMutations(options: UseDiagramMutationsOptions) {
  const { astHook, updateSelectedNodeHalo = () => {}, updateSelectedEdgeHalo = () => {} } =
    options;

  const {
    driver,
    ast,
    syntaxError,
    setSyntaxError,
    displayNodes,
    displayEdges,
    displaySubgraphs,
    displayDirection,
    applyMutation,
  } = astHook;

  const m = driver.mutations;
  const anchors = m.anchors;
  const clipboardNodesRef = useRef<string[]>([]);

  // Selection helpers using Zustand
  const getSelectedNodeId = () => {
    const ids = useCanvasStore.getState().selectedNodeIds;
    return ids.size === 1 ? Array.from(ids)[0] : null;
  };

  const getSelectedEdgeId = () => {
    const ids = useCanvasStore.getState().selectedEdgeIds;
    return ids.size === 1 ? Array.from(ids)[0] : null;
  };

  const setSelectedNodeId = useCallback(
    (id: string | null) => {
      const newSet = id ? new Set([id]) : new Set<string>();
      useCanvasStore.getState().setSelectedNodeIds(newSet);
      updateSelectedNodeHalo(newSet);
      if (!id) {
        useCanvasStore.getState().setSelectedNodeRect(null);
      }
    },
    [updateSelectedNodeHalo]
  );

  const setSelectedEdgeId = useCallback(
    (id: string | null) => {
      const newSet = id ? new Set([id]) : new Set<string>();
      useCanvasStore.getState().setSelectedEdgeIds(newSet);
      updateSelectedEdgeHalo(newSet);
      if (!id) {
        useCanvasStore.getState().setSelectedEdgePos(null);
      }
    },
    [updateSelectedEdgeHalo]
  );

  // --------------------------------------------------------------------------
  // Node Operations
  // --------------------------------------------------------------------------
  const handleSproutNextStep = useCallback(
    (parentId: string) => {
      let createdChildId: string | null = null;
      applyMutation((currentAst) => {
        createdChildId = m.addChildNode(currentAst, parentId, driver.labels.addChild);
      }, parentId);
      if (createdChildId) {
        setSelectedNodeId(createdChildId);
      }
    },
    [m, driver, applyMutation, setSelectedNodeId]
  );

  const handleDeleteSelectedNode = useCallback(() => {
    const selectedNodeId = getSelectedNodeId();
    if (!selectedNodeId) return;
    const targetId = selectedNodeId;
    const starKind = useCanvasStore.getState().selectedStarKind;

    // Clear selection immediately
    setSelectedNodeId(null);
    useCanvasStore.getState().setSelectedNodeRect(null);
    useCanvasStore.getState().setActiveNodePopover(null);
    updateSelectedNodeHalo(new Set());
    useCanvasStore.getState().setSelectedStarKind(null);

    if (anchors?.isAnchor(targetId)) {
      applyMutation((a) => {
        const compositeId = targetId.startsWith('[*]:') ? targetId.slice(4) : undefined;
        anchors.delete(a, starKind ?? null, compositeId);
      });
      return;
    }
    applyMutation((a) => {
      m.deleteNode(a, targetId);
    });
  }, [anchors, m, setSelectedNodeId, updateSelectedNodeHalo, applyMutation]);

  const handleUpdateNodeKind = useCallback(
    (kind: string, specificId?: string) => {
      const state = useCanvasStore.getState();
      const targets = specificId
        ? [specificId]
        : state.selectedNodeIds.size > 1
        ? Array.from(state.selectedNodeIds)
        : getSelectedNodeId()
        ? [getSelectedNodeId()!]
        : [];
      if (targets.length === 0) return;
      applyMutation((a) => {
        m.updateNodesKind(a, targets, kind);
      }, specificId || getSelectedNodeId() || undefined);
      useCanvasStore.getState().setActiveNodePopover(null);
    },
    [m, applyMutation]
  );

  const handleBatchUpdateNodeKind = useCallback(
    (kind: string) => {
      const state = useCanvasStore.getState();
      const filtered = Array.from(state.selectedNodeIds).filter(
        (id) => !(anchors && anchors.isAnchor(id))
      );
      if (filtered.length === 0) return;
      applyMutation((a) => {
        m.updateNodesKind(a, filtered, kind);
      });
      useCanvasStore.getState().setActiveMultiPopover(null);
    },
    [anchors, m, applyMutation]
  );

  const handleApplyNodePreset = useCallback(
    (preset: ThemePreset, specificId?: string) => {
      const state = useCanvasStore.getState();
      const targets = specificId
        ? [specificId]
        : state.selectedNodeIds.size > 0
        ? Array.from(state.selectedNodeIds)
        : getSelectedNodeId()
        ? [getSelectedNodeId()!]
        : [];

      applyMutation((a) => {
        if (!preset.fill && !preset.stroke && !preset.color) {
          m.clearNodesStyle(a, targets);
        } else {
          const styles: Record<string, string> = {};
          if (preset.fill) styles['fill'] = preset.fill;
          if (preset.stroke) styles['stroke'] = preset.stroke;
          if (preset.color) styles['color'] = preset.color;
          m.updateNodesStyle(a, targets, styles);
        }
      }, specificId || getSelectedNodeId() || undefined);
    },
    [m, applyMutation]
  );

  const handleUpdateCustomStyle = useCallback(
    (property: string, value: string, specificId?: string) => {
      const target = specificId || getSelectedNodeId();
      if (!target) return;

      applyMutation((a) => {
        const currentStyle = m.getNodeStyle(a, target) || {};
        const updated = { ...currentStyle };
        if (value) {
          updated[property] = value;
        } else {
          delete updated[property];
        }
        m.updateNodeStyle(a, target, Object.keys(updated).length > 0 ? updated : null);
      }, specificId || getSelectedNodeId() || undefined);
    },
    [m, applyMutation]
  );

  const handleClearNodeStyle = useCallback(
    (specificId?: string) => {
      const target = specificId || getSelectedNodeId();
      if (!target) return;

      applyMutation((a) => {
        m.clearNodeStyle(a, target);
      }, specificId || getSelectedNodeId() || undefined);
    },
    [m, applyMutation]
  );

  const handleAddStandaloneStep = useCallback(() => {
    let createdNodeId: string | null = null;
    applyMutation((a) => {
      createdNodeId = m.addNode(a, `New ${driver.labels.node}`);
    });
    if (createdNodeId) {
      setSelectedNodeId(createdNodeId);
    }
  }, [m, driver, applyMutation, setSelectedNodeId]);

  const handleToggleDirection = useCallback(() => {
    if (!driver.capabilities.supportsDirection) return;
    const currentDir = m.getDirection(ast) || 'TD';
    const nextDir = currentDir === 'LR' ? 'TD' : 'LR';
    applyMutation((a) => {
      m.setDirection(a, nextDir);
    });
  }, [driver, m, ast, applyMutation]);

  const handleAddStartState = useCallback((compositeId?: string) => {
    if (!anchors) return null;
    let createdId: string | null = null;
    applyMutation((a) => {
      createdId = anchors.add(a, 'start', compositeId);
    });
    if (createdId) {
      setSelectedNodeId(createdId);
    }
    return createdId;
  }, [anchors, applyMutation, setSelectedNodeId]);

  const handleAddEndState = useCallback((compositeId?: string) => {
    if (!anchors) return null;
    let createdId: string | null = null;
    applyMutation((a) => {
      createdId = anchors.add(a, 'end', compositeId);
    });
    if (createdId) {
      setSelectedNodeId(createdId);
    }
    return createdId;
  }, [anchors, applyMutation, setSelectedNodeId]);

  const handleConnectToEnd = useCallback(() => {
    const selectedNodeId = getSelectedNodeId();
    if (!selectedNodeId || !anchors) return;
    applyMutation((a) => {
      anchors.connectToEnd(a, selectedNodeId);
    });
  }, [anchors, applyMutation]);

  // --------------------------------------------------------------------------
  // Edge Operations
  // --------------------------------------------------------------------------
  const handleChangeEdgeType = useCallback(
    (newType: string) => {
      const selectedEdgeId = getSelectedEdgeId();
      if (!selectedEdgeId || !m.updateEdgeType) return;
      applyMutation((a) => {
        m.updateEdgeType!(a, selectedEdgeId, newType);
      });
      const pos = useCanvasStore.getState().selectedEdgePos;
      if (pos) {
        useCanvasStore.getState().setSelectedEdgePos({ ...pos, arrowType: newType as ArrowType });
      }
    },
    [m, applyMutation]
  );

  const handleReverseEdge = useCallback(() => {
    const selectedEdgeId = getSelectedEdgeId();
    if (!selectedEdgeId) return;
    let newEdgeId: string | null = null;
    applyMutation((a) => {
      newEdgeId = m.reverseEdge(a, selectedEdgeId);
    });
    if (newEdgeId) {
      setSelectedEdgeId(newEdgeId);
      const pos = useCanvasStore.getState().selectedEdgePos;
      if (pos) {
        useCanvasStore.getState().setSelectedEdgePos({
          ...pos,
          from: pos.to,
          to: pos.from,
        });
      }
    }
  }, [m, applyMutation, setSelectedEdgeId]);

  const handleInsertNodeOnEdge = useCallback(
    (edgeId: string) => {
      let createdNodeId: string | null = null;
      applyMutation((a) => {
        createdNodeId = m.insertNodeOnEdge(a, edgeId, `New ${driver.labels.node}`);
      });
      setSelectedEdgeId(null);
      useCanvasStore.getState().setSelectedEdgePos(null);
      if (createdNodeId) {
        setSelectedNodeId(createdNodeId);
      }
    },
    [m, driver, applyMutation, setSelectedEdgeId, setSelectedNodeId]
  );

  const handleDeleteSelectedEdge = useCallback(() => {
    const selectedEdgeId = getSelectedEdgeId();
    if (!selectedEdgeId) return;
    const targetEdgeId = selectedEdgeId;
    useCanvasStore.getState().setSelectedEdgeIds(new Set());
    useCanvasStore.getState().setSelectedEdgePos(null);
    updateSelectedEdgeHalo(new Set());
    applyMutation((a) => {
      m.deleteEdge(a, targetEdgeId);
    });
  }, [m, updateSelectedEdgeHalo, applyMutation]);

  const handleUpdateEdgeLabel = useCallback(
    (newLabel: string) => {
      const selectedEdgeId = getSelectedEdgeId();
      if (!selectedEdgeId) return;
      applyMutation((a) => {
        m.updateEdgeLabel(a, selectedEdgeId, newLabel);
      });
      const pos = useCanvasStore.getState().selectedEdgePos;
      if (pos) {
        useCanvasStore.getState().setSelectedEdgePos({ ...pos, label: newLabel });
      }
    },
    [m, applyMutation]
  );

  const handleApplyEdgePreset = useCallback(
    (preset: EdgeThemePreset) => {
      const selectedEdgeId = getSelectedEdgeId();
      if (!selectedEdgeId || !m.updateEdgeStyle || !m.clearEdgeStyle) return;
      const target = selectedEdgeId;

      applyMutation((a) => {
        if (!preset.stroke) {
          m.clearEdgeStyle!(a, target);
        } else {
          const styles: Record<string, string> = { stroke: preset.stroke };
          m.updateEdgeStyle!(a, target, styles);
        }
      });
    },
    [m, applyMutation]
  );

  const handleUpdateEdgeCustomStyle = useCallback(
    (property: string, value: string) => {
      const selectedEdgeId = getSelectedEdgeId();
      if (!selectedEdgeId || !m.updateEdgeStyle || !m.getEdgeStyle) return;
      const target = selectedEdgeId;

      applyMutation((a) => {
        const currentStyle = m.getEdgeStyle!(a, target) || {};
        const updated = { ...currentStyle };
        if (value) {
          updated[property] = value;
        } else {
          delete updated[property];
        }
        m.updateEdgeStyle!(a, target, Object.keys(updated).length > 0 ? updated : null);
      });
    },
    [m, applyMutation]
  );

  const handleClearEdgeStyle = useCallback(() => {
    const selectedEdgeId = getSelectedEdgeId();
    if (!selectedEdgeId || !m.clearEdgeStyle) return;
    applyMutation((a) => {
      m.clearEdgeStyle!(a, selectedEdgeId);
    });
  }, [m, applyMutation]);

  // --------------------------------------------------------------------------
  // Subgraph Operations
  // --------------------------------------------------------------------------
  const handleAddGroup = useCallback(() => {
    applyMutation((a) => {
      m.createGroup(a, `New ${driver.labels.group}`);
    });
  }, [m, driver, applyMutation]);

  const handleApplySubgraphPreset = useCallback(
    (preset: ThemePreset) => {
      const selectedSubgraphId = useCanvasStore.getState().selectedSubgraphId;
      if (!selectedSubgraphId) return;
      const target = selectedSubgraphId;

      applyMutation((a) => {
        if (!preset.fill && !preset.stroke && !preset.color) {
          m.clearGroupStyle(a, target);
        } else {
          const styles: Record<string, string> = {};
          if (preset.fill) styles['fill'] = preset.fill;
          if (preset.stroke) styles['stroke'] = preset.stroke;
          if (preset.color) styles['color'] = preset.color;
          m.updateGroupStyle(a, target, styles);
        }
      });
    },
    [m, applyMutation]
  );

  const handleUpdateSubgraphCustomStyle = useCallback(
    (property: string, value: string) => {
      const selectedSubgraphId = useCanvasStore.getState().selectedSubgraphId;
      if (!selectedSubgraphId) return;
      const target = selectedSubgraphId;

      applyMutation((a) => {
        const currentStyle = m.getGroupStyle(a, target) || {};
        const updated = { ...currentStyle };
        if (value) {
          updated[property] = value;
        } else {
          delete updated[property];
        }
        m.updateGroupStyle(a, target, Object.keys(updated).length > 0 ? updated : null);
      });
    },
    [m, applyMutation]
  );

  const handleClearSubgraphStyle = useCallback(() => {
    const selectedSubgraphId = useCanvasStore.getState().selectedSubgraphId;
    if (!selectedSubgraphId) return;
    applyMutation((a) => {
      m.clearGroupStyle(a, selectedSubgraphId);
    });
  }, [m, applyMutation]);

  const handleDissolveSubgraph = useCallback(() => {
    const selectedSubgraphId = useCanvasStore.getState().selectedSubgraphId;
    if (!selectedSubgraphId) return;
    applyMutation((a) => {
      m.deleteGroup(a, selectedSubgraphId, false);
    });
    useCanvasStore.getState().setSelectedSubgraphId(null);
    useCanvasStore.getState().setSelectedSubgraphRect(null);
    useCanvasStore.getState().setActiveSubgraphPopover(null);
  }, [m, applyMutation]);

  const handleDeleteSubgraphAll = useCallback(() => {
    const selectedSubgraphId = useCanvasStore.getState().selectedSubgraphId;
    if (!selectedSubgraphId) return;
    applyMutation((a) => {
      m.deleteGroup(a, selectedSubgraphId, true);
    });
    useCanvasStore.getState().setSelectedSubgraphId(null);
    useCanvasStore.getState().setSelectedSubgraphRect(null);
    useCanvasStore.getState().setActiveSubgraphPopover(null);
  }, [m, applyMutation]);

  const handleRenameSubgraph = useCallback(
    (subId: string, label: string) => {
      applyMutation((a) => {
        m.renameGroup(a, subId, label);
      });
    },
    [m, applyMutation]
  );

  const handleMoveNodeToSubgraph = useCallback(
    (nodeId: string, subId: string | null) => {
      applyMutation((a) => {
        m.moveNodeToGroup(a, nodeId, subId);
      }, nodeId);
    },
    [m, applyMutation]
  );

  const handleCreateGroupWithNode = useCallback(
    (nodeId: string) => {
      applyMutation((a) => {
        m.createGroupWithMembers(a, `New ${driver.labels.group}`, [nodeId]);
      }, nodeId);
    },
    [m, driver, applyMutation]
  );

  // --------------------------------------------------------------------------
  // Batch Operations (Multi-select)
  // --------------------------------------------------------------------------
  const handleBatchDeleteSelected = useCallback(() => {
    const state = useCanvasStore.getState();
    if (state.selectedSubgraphId) {
      applyMutation((a) => {
        m.deleteGroup(a, state.selectedSubgraphId!, false);
      });
      useCanvasStore.getState().setSelectedSubgraphId(null);
      useCanvasStore.getState().setSelectedSubgraphRect(null);
      useCanvasStore.getState().setActiveSubgraphPopover(null);
      return;
    }

    if (state.selectedNodeIds.size === 0 && state.selectedEdgeIds.size === 0) return;
    const nodesToDelete = Array.from(state.selectedNodeIds);
    const edgesToDelete = Array.from(state.selectedEdgeIds);

    useCanvasStore.getState().clearSelection();
    updateSelectedNodeHalo(new Set());
    updateSelectedEdgeHalo(new Set());

    applyMutation((a) => {
      if (nodesToDelete.length > 0) {
        m.deleteNodes(a, nodesToDelete);
      }
      if (edgesToDelete.length > 0) {
        m.deleteEdges(a, edgesToDelete);
      }
    });
  }, [m, applyMutation, updateSelectedNodeHalo, updateSelectedEdgeHalo]);

  const handleBatchApplyThemePreset = useCallback(
    (preset: ThemePreset) => {
      const state = useCanvasStore.getState();
      const filtered = Array.from(state.selectedNodeIds).filter(
        (id) => !(anchors && anchors.isAnchor(id))
      );
      const edgeIds = Array.from(state.selectedEdgeIds);

      applyMutation((a) => {
        if (filtered.length > 0) {
          if (!preset.fill && !preset.stroke && !preset.color) {
            m.clearNodesStyle(a, filtered);
          } else {
            const styles: Record<string, string> = {};
            if (preset.fill) styles['fill'] = preset.fill;
            if (preset.stroke) styles['stroke'] = preset.stroke;
            if (preset.color) styles['color'] = preset.color;
            m.updateNodesStyle(a, filtered, styles);
          }
        }
        if (edgeIds.length > 0 && m.updateEdgesStyle && m.clearEdgesStyle) {
          if (!preset.stroke) {
            m.clearEdgesStyle(a, edgeIds);
          } else {
            const edgeStyles: Record<string, string> = { stroke: preset.stroke };
            m.updateEdgesStyle(a, edgeIds, edgeStyles);
          }
        }
      });
    },
    [anchors, m, applyMutation]
  );

  const handleBatchClearStyle = useCallback(() => {
    const state = useCanvasStore.getState();
    const filtered = Array.from(state.selectedNodeIds).filter(
      (id) => !(anchors && anchors.isAnchor(id))
    );
    const edgeIds = Array.from(state.selectedEdgeIds);

    applyMutation((a) => {
      if (filtered.length > 0) {
        m.clearNodesStyle(a, filtered);
      }
      if (edgeIds.length > 0 && m.clearEdgesStyle) {
        m.clearEdgesStyle(a, edgeIds);
      }
    });
  }, [anchors, m, applyMutation]);

  const handleBatchUpdateStyle = useCallback(
    (property: string, value: string) => {
      const state = useCanvasStore.getState();
      const filtered = Array.from(state.selectedNodeIds).filter(
        (id) => !(anchors && anchors.isAnchor(id))
      );
      const edgeIds = Array.from(state.selectedEdgeIds);

      applyMutation((a) => {
        for (const nodeId of filtered) {
          const currentStyle = m.getNodeStyle(a, nodeId) || {};
          const updated = { ...currentStyle };
          if (value) {
            updated[property] = value;
          } else {
            delete updated[property];
          }
          m.updateNodeStyle(a, nodeId, Object.keys(updated).length > 0 ? updated : null);
        }
        if (edgeIds.length > 0 && m.updateEdgeStyle && m.getEdgeStyle) {
          for (const edgeId of edgeIds) {
            const currentStyle = m.getEdgeStyle(a, edgeId) || {};
            const updated = { ...currentStyle };
            if (value) {
              updated[property] = value;
            } else {
              delete updated[property];
            }
            m.updateEdgeStyle(a, edgeId, Object.keys(updated).length > 0 ? updated : null);
          }
        }
      });
    },
    [anchors, m, applyMutation]
  );

  const handleBatchUpdateEdgeType = useCallback(
    (newType: string) => {
      const state = useCanvasStore.getState();
      if (!m.updateEdgesType || state.selectedEdgeIds.size === 0) return;
      applyMutation((a) => {
        m.updateEdgesType!(a, Array.from(state.selectedEdgeIds), newType);
      });
      useCanvasStore.getState().setActiveMultiPopover(null);
    },
    [m, applyMutation]
  );

  const handleBatchCreateGroup = useCallback(() => {
    const state = useCanvasStore.getState();
    const filtered = Array.from(state.selectedNodeIds).filter(
      (id) => !(anchors && anchors.isAnchor(id))
    );
    if (filtered.length === 0) return;
    applyMutation((a) => {
      m.createGroupWithMembers(a, `New ${driver.labels.group}`, filtered);
    });
    useCanvasStore.getState().clearSelection();
    updateSelectedNodeHalo(new Set());
    updateSelectedEdgeHalo(new Set());
  }, [anchors, m, driver, applyMutation, updateSelectedNodeHalo, updateSelectedEdgeHalo]);

  const handleBatchUngroup = useCallback(() => {
    const state = useCanvasStore.getState();
    if (state.selectedNodeIds.size === 0) return;
    applyMutation((a) => {
      m.moveNodesToGroup(a, Array.from(state.selectedNodeIds), null);
    });
  }, [m, applyMutation]);

  // --------------------------------------------------------------------------
  // Clipboard Operations
  // --------------------------------------------------------------------------
  const applyDuplication = useCallback(
    (nodeIds: Iterable<string>) => {
      applyMutation((currentAst) => {
        const result = m.duplicateNodes(currentAst, nodeIds);
        if (result.nodeIds.length > 0) {
          const newSet = new Set(result.nodeIds);
          const newEdges = new Set(result.edgeIds);
          useCanvasStore.getState().setSelectedNodeIds(newSet);
          useCanvasStore.getState().setSelectedEdgeIds(newEdges);
          updateSelectedNodeHalo(newSet);
          updateSelectedEdgeHalo(newEdges);
        }
      });
    },
    [m, applyMutation, updateSelectedNodeHalo, updateSelectedEdgeHalo]
  );

  const handleDuplicateSelected = useCallback(() => {
    const state = useCanvasStore.getState();
    if (state.selectedNodeIds.size === 0) return;
    const filteredIds = Array.from(state.selectedNodeIds).filter(
      (id) => !(anchors && anchors.isAnchor(id))
    );
    if (filteredIds.length === 0) return;
    applyDuplication(filteredIds);
  }, [anchors, applyDuplication]);

  const handleCopySelected = useCallback(() => {
    const state = useCanvasStore.getState();
    if (state.selectedNodeIds.size > 0) {
      const filtered = Array.from(state.selectedNodeIds).filter(
        (id) => !(anchors && anchors.isAnchor(id))
      );
      if (filtered.length > 0) clipboardNodesRef.current = filtered;
    }
  }, [anchors]);

  const handlePasteSelected = useCallback(() => {
    if (clipboardNodesRef.current.length === 0) return;
    applyDuplication(clipboardNodesRef.current);
  }, [applyDuplication]);

  return {
    // Model state
    driver,
    ast,
    displayNodes,
    displayEdges,
    displaySubgraphs,
    displayDirection,
    syntaxError,
    setSyntaxError,
    applyMutation,

    // Node operations
    handleSproutNextStep,
    handleDeleteSelectedNode,
    handleUpdateNodeKind,
    handleBatchUpdateNodeKind,
    handleApplyNodePreset,
    handleUpdateCustomStyle,
    handleClearNodeStyle,
    handleAddStandaloneStep,
    handleToggleDirection,
    handleAddStartState,
    handleAddEndState,
    handleConnectToEnd,
    hasStartState: anchors ? anchors.has(ast, 'start') : false,
    hasEndState: anchors ? anchors.has(ast, 'end') : false,

    // Edge operations
    handleChangeEdgeType,
    handleReverseEdge,
    handleInsertNodeOnEdge,
    handleDeleteSelectedEdge,
    handleUpdateEdgeLabel,
    handleApplyEdgePreset,
    handleUpdateEdgeCustomStyle,
    handleClearEdgeStyle,

    // Group operations
    handleAddGroup,
    handleApplySubgraphPreset,
    handleUpdateSubgraphCustomStyle,
    handleClearSubgraphStyle,
    handleDissolveSubgraph,
    handleDeleteSubgraphAll,
    handleRenameSubgraph,
    handleMoveNodeToSubgraph,
    handleCreateGroupWithNode,

    // Batch operations
    handleBatchDeleteSelected,
    handleBatchApplyThemePreset,
    handleBatchClearStyle,
    handleBatchUpdateStyle,
    handleBatchUpdateCustomStyle: handleBatchUpdateStyle,
    handleBatchUpdateEdgeType,
    handleBatchCreateGroup,
    handleBatchGroupSelected: handleBatchCreateGroup,
    handleBatchUngroup,
    handleBatchUngroupSelected: handleBatchUngroup,

    // Clipboard operations
    handleDuplicateSelected,
    handleCopySelected,
    handlePasteSelected,
  };
}
