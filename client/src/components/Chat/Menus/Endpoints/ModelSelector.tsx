import React, { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { getConfigDefaults } from 'librechat-data-provider';
import type { ModelSelectorProps } from '~/common';
import {
  renderModelSpecs,
  renderEndpoints,
  renderSearchResults,
  renderCustomGroups,
  EndpointMenuContent,
} from './components';
import { ModelSelectorProvider, useModelSelectorContext } from './ModelSelectorContext';
import { useShortcutAriaKey, useShortcutHint } from '~/hooks/useKeyboardShortcuts';
import { ModelSelectorChatProvider } from './ModelSelectorChatContext';
import { CustomMenu as Menu, CustomMenuGroup } from './CustomMenu';
import { getSelectedIcon, getDisplayValue } from './utils';
import DialogManager from './DialogManager';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const defaultInterface = getConfigDefaults().interface;

/** The composer's model picker: a quiet pill beside the `+`, filled on hover and a step further
 *  while its menu is open. */
const composerTriggerClassName =
  'text-text-secondary hover:bg-surface-hover hover:text-text-primary aria-expanded:bg-surface-active-alt aria-expanded:text-text-primary rounded-theme-control-round h-9 w-auto gap-1.5 border-0 bg-transparent px-3 py-0 transition-colors';

function ModelSelectorContent({ variant = 'header' }: Pick<ModelSelectorProps, 'variant'>) {
  const localize = useLocalize();
  const modelSelectorHint = useShortcutHint('openModelSelector', localize('com_ui_select_model'));
  const modelSelectorAriaKey = useShortcutAriaKey('openModelSelector');

  const {
    // LibreChat
    agentsMap,
    modelSpecs,
    mappedEndpoints,
    endpointsConfig,
    // State
    searchValue,
    searchResults,
    selectedValues,
    // Functions
    setSearchValue,
    setSelectedValues,
    // Dialog
    keyDialogOpen,
    onOpenChange,
    keyDialogEndpoint,
  } = useModelSelectorContext();

  const selectedIcon = useMemo(
    () =>
      getSelectedIcon({
        mappedEndpoints: mappedEndpoints ?? [],
        selectedValues,
        modelSpecs,
        endpointsConfig,
        agentsMap,
      }),
    [mappedEndpoints, selectedValues, modelSpecs, endpointsConfig, agentsMap],
  );
  const selectedDisplayValue = useMemo(
    () =>
      getDisplayValue({
        localize,
        agentsMap,
        modelSpecs,
        selectedValues,
        mappedEndpoints,
      }),
    [localize, agentsMap, modelSpecs, selectedValues, mappedEndpoints],
  );

  const isComposer = variant === 'composer';
  /** With one endpoint and no specs there is nothing to choose between but models, so the
   *  composer lists them flat under one heading instead of behind the endpoint's submenu. */
  const onlyEndpoint =
    isComposer &&
    !modelSpecs?.length &&
    mappedEndpoints?.length === 1 &&
    mappedEndpoints[0].hasModels
      ? mappedEndpoints[0]
      : null;
  const trigger = (
    <TooltipAnchor
      aria-label={localize('com_ui_select_model')}
      description={modelSelectorHint}
      render={
        <button
          /* The composer variant lives inside the chat form, where a bare button submits. */
          type="button"
          data-testid="model-selector-button"
          aria-keyshortcuts={modelSelectorAriaKey}
          className={cn(
            'flex h-9 max-w-full items-center text-sm',
            !isComposer &&
              'border-border-chrome bg-presentation text-text-primary hover:bg-surface-active-alt rounded-theme-control my-1 gap-2 border px-3 py-2',
          )}
          aria-label={localize('com_ui_select_model')}
        >
          {!isComposer && selectedIcon && React.isValidElement(selectedIcon) && (
            <div className="flex shrink-0 items-center justify-center overflow-hidden">
              {selectedIcon}
            </div>
          )}
          <span className="truncate text-left">{selectedDisplayValue}</span>
          {isComposer && <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />}
        </button>
      }
    />
  );

  const menuBody = onlyEndpoint ? (
    <CustomMenuGroup label={localize('com_ui_model')}>
      <EndpointMenuContent endpoint={onlyEndpoint} endpointIndex={0} />
    </CustomMenuGroup>
  ) : (
    <>
      {/* Render ungrouped modelSpecs (no group field) */}
      {renderModelSpecs(
        modelSpecs?.filter((spec) => !spec.group) || [],
        selectedValues.modelSpec || '',
      )}
      {/* Render endpoints (will include grouped specs matching endpoint names) */}
      {renderEndpoints(mappedEndpoints ?? [])}
      {/* Render custom groups (specs with group field not matching any endpoint) */}
      {renderCustomGroups(modelSpecs || [], mappedEndpoints ?? [])}
    </>
  );

  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-col items-center gap-2',
        isComposer ? 'max-w-[18rem]' : 'max-w-[60vw] sm:max-w-xs',
      )}
    >
      <Menu
        /* The menu merges this over its own root trigger look, so the quiet pill wins there
           rather than racing the trigger's classes in the stylesheet. */
        className={isComposer ? composerTriggerClassName : undefined}
        values={selectedValues}
        onValuesChange={(values: Record<string, any>) => {
          setSelectedValues({
            endpoint: values.endpoint || '',
            model: values.model || '',
            modelSpec: values.modelSpec || '',
          });
        }}
        onSearch={(value) => setSearchValue(value)}
        combobox={<input id="model-search" placeholder=" " />}
        comboboxLabel={localize('com_endpoint_search_models')}
        trigger={trigger}
      >
        {searchResults ? renderSearchResults(searchResults, localize, searchValue) : menuBody}
      </Menu>
      <DialogManager
        keyDialogOpen={keyDialogOpen}
        onOpenChange={onOpenChange}
        endpointsConfig={endpointsConfig || {}}
        keyDialogEndpoint={keyDialogEndpoint || undefined}
      />
    </div>
  );
}

export default function ModelSelector({ startupConfig, variant }: ModelSelectorProps) {
  const interfaceConfig = startupConfig?.interface ?? defaultInterface;
  const modelSpecs = startupConfig?.modelSpecs?.list ?? [];

  // Hide the selector when modelSelect is false and there are no model specs to show
  if (interfaceConfig.modelSelect === false && modelSpecs.length === 0) {
    return null;
  }

  return (
    <ModelSelectorChatProvider>
      <ModelSelectorProvider startupConfig={startupConfig}>
        <ModelSelectorContent variant={variant} />
      </ModelSelectorProvider>
    </ModelSelectorChatProvider>
  );
}
