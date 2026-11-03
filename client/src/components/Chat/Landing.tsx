import { useMemo, useState, useEffect, useRef } from 'react';
import { HatGlasses } from 'lucide-react';
import { EModelEndpoint } from 'librechat-data-provider';
import { BirthdayIcon, TooltipAnchor, useRemScale } from '@librechat/client';
import { useChatContext, useAgentsMapContext, useAssistantsMapContext } from '~/Providers';
import Description, { isHtmlDescription } from '~/components/ui/Description';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import { getIconEndpoint, getEntity, getModelSpec, cn } from '~/utils';
import { useLocalize, useAuthContext, useGreeting } from '~/hooks';
import { useChatSettings } from '~/Providers/ChatSettingsContext';
import AgentContact from '~/components/Agents/AgentContact';
import ConvoIcon from '~/components/Endpoints/ConvoIcon';

const containerClassName =
  'shadow-stroke relative flex h-full items-center justify-center rounded-full bg-presentation text-text-primary dark:after:shadow-none ';

/** The headline fades up into place as one line; under reduced motion it is simply there. */
const headlineClassName =
  'animate-greeting-rise text-text-primary text-center font-semibold tracking-tight motion-reduce:animate-none';

/** Configured landing copy, with `{{user.name}}` filled in once the user has a name. */
function withUserName(text: string | undefined, userName?: string) {
  return text != null && userName ? text.replace(/{{user.name}}/g, userName) : text;
}

function getTextSizeClass(text: string | undefined | null) {
  if (!text) {
    return 'text-xl sm:text-2xl';
  }

  if (text.length < 56) {
    return 'text-2xl sm:text-[1.75rem] sm:leading-[2.125rem]';
  }

  if (text.length < 70) {
    return 'text-xl sm:text-2xl';
  }

  return 'text-lg sm:text-base';
}

export default function Landing({ centerFormOnLanding }: { centerFormOnLanding: boolean }) {
  const { conversation } = useChatContext();
  const agentsMap = useAgentsMapContext();
  const assistantMap = useAssistantsMapContext();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const { user } = useAuthContext();
  const localize = useLocalize();
  const remScale = useRemScale();
  const { isTemporary } = useChatSettings();

  const [textHasMultipleLines, setTextHasMultipleLines] = useState(false);
  const [lineCount, setLineCount] = useState(1);
  const [contentHeight, setContentHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const headlineRef = useRef<HTMLParagraphElement>(null);

  const endpointType = useMemo(() => {
    let ep = conversation?.endpoint ?? '';
    if (ep === EModelEndpoint.azureOpenAI) {
      ep = EModelEndpoint.openAI;
    }
    return getIconEndpoint({
      endpointsConfig,
      iconURL: conversation?.iconURL,
      endpoint: ep,
    });
  }, [conversation?.endpoint, conversation?.iconURL, endpointsConfig]);

  const { entity, isAgent } = getEntity({
    endpoint: endpointType,
    agentsMap,
    assistantMap,
    agent_id: conversation?.agent_id,
    assistant_id: conversation?.assistant_id,
  });

  const modelSpec = useMemo(
    () => getModelSpec({ specName: conversation?.spec, startupConfig }),
    [conversation?.spec, startupConfig],
  );

  const brandedSpecLabel = modelSpec?.showOnLanding ? modelSpec.label : '';
  const brandedSpecDescription = (modelSpec?.showOnLanding && modelSpec.description) || '';
  const name = isTemporary ? '' : (entity?.name ?? brandedSpecLabel);
  const description = isTemporary
    ? localize('com_ui_temporary_description')
    : ((entity?.description || brandedSpecDescription || conversation?.greeting) ?? '');
  const descriptionIsHTML = isHtmlDescription(description);
  const selectedAgent =
    isAgent && conversation?.agent_id != null ? agentsMap?.[conversation.agent_id] : undefined;

  const customWelcome =
    typeof startupConfig?.interface?.customWelcome === 'string'
      ? startupConfig.interface.customWelcome
      : undefined;
  const customSubtitle =
    typeof startupConfig?.interface?.customWelcomeSubtitle === 'string'
      ? startupConfig.interface.customWelcomeSubtitle
      : undefined;

  const scheduledGreeting = useGreeting(user?.name);

  const getDynamicMargin = useMemo(() => {
    let margin = 'mb-0';

    if (lineCount > 2 || (description && description.length > 100)) {
      margin = 'mb-10';
    } else if (lineCount > 1 || (description && description.length > 0)) {
      margin = 'mb-6';
    } else if (textHasMultipleLines) {
      margin = 'mb-4';
    }

    if (contentHeight > 200) {
      margin = 'mb-16';
    } else if (contentHeight > 150) {
      margin = 'mb-12';
    }

    return margin;
  }, [lineCount, description, textHasMultipleLines, contentHeight]);

  const resolvedWelcome = withUserName(customWelcome, user?.name);
  const subtitle = isTemporary ? undefined : withUserName(customSubtitle, user?.name);

  const greetingText = isTemporary
    ? localize('com_ui_temporary')
    : (resolvedWelcome ?? scheduledGreeting);
  const headline = name || greetingText;

  /** The icon stacks over a headline that wraps, so count its lines once it has laid out. */
  useEffect(() => {
    const element = headlineRef.current;
    if (!element) {
      return;
    }
    const style = getComputedStyle(element);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const count = Math.round(element.offsetHeight / lineHeight);
    setTextHasMultipleLines(count > 1);
    setLineCount(count);
  }, [headline, remScale]);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.offsetHeight);
    }
  }, [lineCount, description, subtitle, selectedAgent, remScale]);

  return (
    /* On a phone the composer sits at the foot of the screen, so the greeting settles just above
       it rather than floating mid-screen; from `sm` up the two are centered together. */
    <div
      className={`flex h-full transform-gpu flex-col items-center justify-end pb-4 transition-all duration-200 sm:justify-center sm:pb-16 ${centerFormOnLanding ? 'max-h-full sm:max-h-0' : 'max-h-full'} ${getDynamicMargin}`}
    >
      <div ref={contentRef} className="flex flex-col items-center gap-0 p-2">
        <div
          className={`flex ${textHasMultipleLines ? 'flex-col' : 'flex-col md:flex-row'} items-center justify-center gap-2`}
        >
          {/* A plain greeting stands alone, as the screen's one headline; the icon introduces an
              agent, an assistant, a branded spec or a temporary chat. */}
          {(isTemporary || name) && (
            <div
              className={`relative size-10 justify-center ${textHasMultipleLines ? 'mb-2' : ''}`}
            >
              {isTemporary ? (
                <div className={containerClassName}>
                  <HatGlasses className="text-text-primary h-2/3 w-2/3" aria-hidden="true" />
                </div>
              ) : (
                <ConvoIcon
                  agentsMap={agentsMap}
                  assistantMap={assistantMap}
                  conversation={conversation}
                  endpointsConfig={endpointsConfig}
                  containerClassName={containerClassName}
                  context="landing"
                  className="text-text-primary h-2/3 w-2/3"
                  size={41}
                />
              )}
              {startupConfig?.showBirthdayIcon && (
                <TooltipAnchor
                  className="absolute right-2 bottom-[1.6875rem]"
                  description={localize('com_ui_happy_birthday')}
                  aria-label={localize('com_ui_happy_birthday')}
                >
                  <BirthdayIcon />
                </TooltipAnchor>
              )}
            </div>
          )}
          {name ? (
            <div className="flex flex-col items-center gap-0 p-2">
              <p
                key={name}
                ref={headlineRef}
                dir="auto"
                className={cn(getTextSizeClass(name), headlineClassName)}
              >
                {name}
              </p>
            </div>
          ) : (
            /* The key replays the entrance when the greeting changes. */
            <div key={greetingText} className="flex flex-col items-center">
              <p
                ref={headlineRef}
                dir="auto"
                className={cn(getTextSizeClass(greetingText), headlineClassName)}
              >
                {greetingText}
              </p>
              {subtitle && (
                <p
                  dir="auto"
                  className="animate-greeting-rise-late text-text-secondary mt-2 text-center text-base motion-reduce:animate-none sm:text-lg"
                >
                  {subtitle}
                </p>
              )}
            </div>
          )}
        </div>
        <Description
          allowMedia
          description={description}
          className={
            descriptionIsHTML
              ? 'animate-fadeIn text-text-primary mt-4 flex max-w-md items-center justify-center gap-2 text-center text-sm font-normal [&_img]:inline-block [&_img]:h-4 [&_img]:w-4'
              : `animate-fadeIn mt-4 max-w-md text-center text-sm font-normal ${isTemporary ? 'text-text-secondary' : 'text-text-primary'}`
          }
        />
        {selectedAgent && !isTemporary && (
          <AgentContact
            agent={selectedAgent}
            className="animate-fadeIn mt-2 max-w-md justify-center text-center text-sm"
          />
        )}
      </div>
    </div>
  );
}
