import {
  ReactFlow,
  Background,
  useReactFlow,
  SelectionMode,
  OnSelectionChangeParams,
  useStoreApi,
  PanOnScrollMode,
  useKeyPress,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { usePrevious } from 'react-use';

import {
  Action,
  ActionType,
  flowStructureUtil,
  FlowVersion,
  isFlowStateTerminal,
  isNil,
  Step,
  StepLocationRelativeToParent,
} from '@activepieces/shared';

import { flowRunUtils } from '../../../features/flow-runs/lib/flow-run-utils';
import { useBuilderStateContext } from '../builder-hooks';

import {
  copySelectedNodes,
  deleteSelectedNodes,
  getActionsInClipboard,
  pasteNodes,
  toggleSkipSelectedNodes,
} from './bulk-actions';
import {
  CanvasContextMenu,
  CanvasContextMenuProps,
} from './context-menu/canvas-context-menu';
import { FlowDragLayer } from './flow-drag-layer';
import {
  ADD_BUTTON_CONTEXT_MENU_ATTRIBUTE,
  flowUtilConsts,
  STEP_CONTEXT_MENU_ATTRIBUTE,
} from './utils/consts';
import { flowCanvasUtils } from './utils/flow-canvas-utils';
import { AboveFlowWidgets } from './widgets';

const getChildrenKey = (step: Step) => {
  switch (step.type) {
    case ActionType.LOOP_ON_ITEMS:
      return step.firstLoopAction ? step.firstLoopAction.name : '';
    case ActionType.ROUTER:
      return step.children.reduce((routerKey, child) => {
        const childrenKey = child
          ? flowStructureUtil
              .getAllSteps(child)
              .reduce(
                (childKey, grandChild) => `${childKey}-${grandChild.name}`,
                '',
              )
          : 'null';
        return `${routerKey}-${childrenKey}`;
      }, '');
    case ActionType.CODE:
    case ActionType.PIECE:
      return '';
  }
};

const createGraphKey = (flowVersion: FlowVersion) => {
  return flowStructureUtil
    .getAllSteps(flowVersion.trigger)
    .reduce((acc, step) => {
      const branchesLength =
        step.type === ActionType.ROUTER ? step.settings.branches.length : 0;
      const childrenKey = getChildrenKey(step);
      return `${acc}-${step.displayName}-${step.type}-${
        step.type === ActionType.PIECE ? step.settings.pieceName : ''
      }-${branchesLength}-${childrenKey}`;
    }, '');
};

export const FlowCanvas = React.memo(
  ({
    setHasCanvasBeenInitialised,
    lefSideBarContainerWidth,
  }: {
    setHasCanvasBeenInitialised: (value: boolean) => void;
    lefSideBarContainerWidth: number;
  }) => {
    const [
      allowCanvasPanning,
      flowVersion,
      run,
      readonly,
      setSelectedNodes,
      selectedNodes,
      applyOperation,
      selectedStep,
      exitStepSettings,
      panningMode,
    ] = useBuilderStateContext((state) => {
      return [
        state.allowCanvasPanning,
        state.flowVersion,
        state.run,
        state.readonly,
        state.setSelectedNodes,
        state.selectedNodes,
        state.applyOperation,
        state.selectedStep,
        state.exitStepSettings,
        state.panningMode,
      ];
    });

    const previousRun = usePrevious(run);
    const { fitView, getViewport, setViewport } = useReactFlow();
    if (
      (run && previousRun?.id !== run.id && isFlowStateTerminal(run.status)) ||
      (run &&
        previousRun &&
        !isFlowStateTerminal(previousRun.status) &&
        isFlowStateTerminal(run.status))
    ) {
      const failedStep = run.steps
        ? flowRunUtils.findFailedStepInOutput(run.steps)
        : null;
      if (failedStep) {
        setTimeout(() => {
          fitView(flowCanvasUtils.createFocusStepInGraphParams(failedStep));
        });
      }
    }
    const containerRef = useRef<HTMLDivElement>(null);
    const containerSizeRef = useRef({
      width: 0,
      height: 0,
    });
    useEffect(() => {
      if (!containerRef.current) return;

      const resizeObserver = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;

        setHasCanvasBeenInitialised(true);
        const { x, y, zoom } = getViewport();

        if (containerRef.current && width !== containerSizeRef.current.width) {
          const newX = x + (width - containerSizeRef.current.width) / 2;
          // Update the viewport to keep content centered without affecting zoom
          setViewport({ x: newX, y, zoom });
        }
        // Adjust x/y values based on the new size and keep the same zoom level

        containerSizeRef.current = {
          width,
          height,
        };
      });

      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
      };
    }, [setViewport, getViewport]);

    const onSelectionChange = useCallback(
      (ev: OnSelectionChangeParams) => {
        setSelectedNodes(ev.nodes.map((n) => n.id));
      },
      [setSelectedNodes],
    );
    const graphKey = createGraphKey(flowVersion);
    const graph = useMemo(() => {
      return flowCanvasUtils.convertFlowVersionToGraph(flowVersion);
    }, [graphKey]);
    const [contextMenuData, setContextMenuData] = useState<
      CanvasContextMenuProps['pasteActionData']
    >({
      addButtonData: null,
      singleSelectedStepName: null,
    });
    const onContextMenu = useCallback(
      (ev: React.MouseEvent<HTMLDivElement>) => {
        if (
          ev.target instanceof HTMLElement ||
          ev.target instanceof SVGElement
        ) {
          const addButtonElement = ev.target.closest(
            `[data-${ADD_BUTTON_CONTEXT_MENU_ATTRIBUTE}]`,
          );
          const addButtonData = addButtonElement?.getAttribute(
            `data-${ADD_BUTTON_CONTEXT_MENU_ATTRIBUTE}`,
          );
          const nodeSelectionActive = !isNil(
            document.querySelector('.react-flow__nodesselection-rect'),
          );
          const stepElement = ev.target.closest(
            `[data-${STEP_CONTEXT_MENU_ATTRIBUTE}]`,
          );
          const stepName = stepElement?.getAttribute(
            `data-${STEP_CONTEXT_MENU_ATTRIBUTE}`,
          );
          const stepNodeIsNotTrigger =
            stepName && stepName !== flowVersion.trigger.name;
          if (addButtonData) {
            setContextMenuData({
              addButtonData: JSON.parse(addButtonData || '{}'),
              singleSelectedStepName: null,
            });
          } else {
            setContextMenuData({
              addButtonData: null,
              singleSelectedStepName: stepName || null,
            });
          }
          setSelectedNodes(
            nodeSelectionActive || addButtonElement
              ? selectedNodes
              : stepNodeIsNotTrigger
              ? [stepName]
              : [],
          );
          if (nodeSelectionActive && stepNodeIsNotTrigger) {
            document
              .querySelector('.react-flow__nodesselection-rect')
              ?.remove();
          }
        }
      },
      [setContextMenuData, setSelectedNodes, selectedNodes],
    );

    const handleKeyDown = useCallback(
      (e: KeyboardEvent) => {
        if (
          e.target instanceof HTMLElement &&
          (e.target === document.body ||
            e.target.classList.contains('react-flow__nodesselection-rect'))
        ) {
          if (e.key === 'c' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            copySelectedNodes({ selectedNodes, flowVersion });
          }
          if (e.key === 'Delete' && e.shiftKey) {
            e.preventDefault();
            deleteSelectedNodes({
              selectedNodes,
              applyOperation,
              selectedStep,
              exitStepSettings,
            });
          }
          if (e.key === 'v' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            getActionsInClipboard().then((actions) => {
              if (actions.length > 0) {
                pasteNodes(
                  actions,
                  flowVersion,
                  {
                    parentStepName: flowStructureUtil
                      .getAllNextActionsWithoutChildren(flowVersion.trigger)
                      .at(-1)!.name,
                    stepLocationRelativeToParent:
                      StepLocationRelativeToParent.AFTER,
                  },
                  applyOperation,
                );
              }
            });
          }
        }
        if (e.key === 'e' && (e.metaKey || e.ctrlKey)) {
          if (selectedNodes.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            toggleSkipSelectedNodes({
              selectedNodes,
              flowVersion,
              applyOperation,
            });
          }
        }
      },
      [
        selectedNodes,
        flowVersion,
        applyOperation,
        selectedStep,
        exitStepSettings,
      ],
    );

    useEffect(() => {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);
    const storeApi = useStoreApi();
    const isShiftKeyPressed = useKeyPress('Shift');
    const inGrabPanningMode = !isShiftKeyPressed && panningMode === 'grab';

    const onSelectionEnd = useCallback(() => {
      const selectedSteps = selectedNodes.map((node) =>
        flowStructureUtil.getStepOrThrow(node, flowVersion.trigger),
      ) as Action[];
      selectedSteps.forEach((step) => {
        if (
          step.type === ActionType.LOOP_ON_ITEMS ||
          step.type === ActionType.ROUTER
        ) {
          const childrenNotSelected = flowStructureUtil
            .getAllChildSteps(step)
            .filter((c) =>
              isNil(selectedNodes.find((n) => n === c.name)),
            ) as Action[];
          selectedSteps.push(...childrenNotSelected);
        }
      });
      storeApi
        .getState()
        .addSelectedNodes(selectedSteps.map((step) => step.name));
      setSelectedNodes(selectedSteps.map((step) => step.name));
    }, [selectedNodes, storeApi, setSelectedNodes]);

    return (
      <div
        ref={containerRef}
        className="size-full relative overflow-hidden z-50"
      >
        <FlowDragLayer lefSideBarContainerWidth={lefSideBarContainerWidth}>
          <CanvasContextMenu
            selectedNodes={selectedNodes}
            applyOperation={applyOperation}
            selectedStep={selectedStep}
            exitStepSettings={exitStepSettings}
            flowVersion={flowVersion}
            pasteActionData={contextMenuData}
            readonly={readonly}
          >
            <ReactFlow
              onContextMenu={onContextMenu}
              onPaneClick={() => {
                storeApi.getState().unselectNodesAndEdges();
              }}
              nodeTypes={flowUtilConsts.nodeTypes}
              nodes={graph.nodes}
              edgeTypes={flowUtilConsts.edgeTypes}
              edges={graph.edges}
              draggable={false}
              edgesFocusable={false}
              elevateEdgesOnSelect={false}
              maxZoom={1.5}
              minZoom={0.5}
              panOnDrag={
                allowCanvasPanning ? (inGrabPanningMode ? [0, 1] : [1]) : false
              }
              zoomOnDoubleClick={false}
              panOnScroll={true}
              panOnScrollMode={PanOnScrollMode.Free}
              fitView={false}
              nodesConnectable={false}
              elementsSelectable={true}
              nodesDraggable={false}
              nodesFocusable={false}
              selectionKeyCode={inGrabPanningMode ? 'Shift' : null}
              multiSelectionKeyCode={inGrabPanningMode ? 'Shift' : null}
              selectionOnDrag={inGrabPanningMode ? false : true}
              selectNodesOnDrag={true}
              selectionMode={SelectionMode.Partial}
              onSelectionChange={onSelectionChange}
              onSelectionEnd={onSelectionEnd}
            >
              <AboveFlowWidgets></AboveFlowWidgets>
              <Background />
            </ReactFlow>
          </CanvasContextMenu>
        </FlowDragLayer>
      </div>
    );
  },
);

FlowCanvas.displayName = 'FlowCanvas';
