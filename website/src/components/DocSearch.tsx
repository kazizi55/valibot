import {
  $,
  component$,
  useComputed$,
  useSignal,
  useTask$,
  type QwikKeyboardEvent,
  type Signal,
} from '@builder.io/qwik';
import { Link, useLocation, useNavigate } from '@builder.io/qwik-city';
import { isBrowser } from '@builder.io/qwik/build';
import clsx from 'clsx';
import { useFocusTrap, useStorageSignal } from '~/hooks';
import { trackEvent } from '~/utils';
import { SystemIcon } from './SystemIcon';
import { TextLink } from './TextLink';
import {
  AngleRightIcon,
  CloseIcon,
  HashtagIcon,
  PageIcon,
  SearchIcon,
} from '~/icons';

type HitType = 'lvl2' | 'lvl3' | 'lvl4' | 'lvl5' | 'content';

type AlgoliaResult = {
  hits: {
    type: HitType;
    hierarchy: {
      lvl0: string;
      lvl1: string;
      lvl2: string;
      lvl3: string | null;
      lvl4: string | null;
    };
    content: string | null;
    url: string;
    _highlightResult: {
      hierarchy: {
        lvl0: { value: string };
        lvl1: { value: string };
        lvl2: { value: string };
        lvl3: { value: string } | undefined;
        lvl4: { value: string } | undefined;
        lvl5: { value: string } | undefined;
      };
    };
    _snippetResult?: {
      content: { value: string };
    };
  }[];
};

type SearchItem = {
  group: string;
  relation: 'page' | 'child' | 'none';
  type: HitType;
  page: string;
  text: string;
  path: string;
};

type SearchStorage = {
  [key: string]:
    | {
        result: SearchItem[];
        expires: number;
      }
    | undefined;
};

type DocSearchProps = {
  open: Signal<boolean>;
};

/**
 * Provides a search box for the documentation.
 */
export const DocSearch = component$<DocSearchProps>(({ open }) => {
  // Use location and navigate
  const location = useLocation();
  const navigate = useNavigate();

  // Use input, loading, active index and error signal
  const input = useSignal('');
  const loading = useSignal(false);
  const activeIndex = useSignal(0);
  const error = useSignal(false);

  // Use modal and input element signal
  const modalElement = useSignal<HTMLDivElement>();
  const inputElement = useSignal<HTMLInputElement>();

  // Use storage, recent, result and clicked signal
  const storage = useStorageSignal<SearchStorage>('search-index', {});
  const recent = useStorageSignal<SearchItem[]>('search-recent', []);
  const result = useSignal<SearchItem[]>([]);
  const clicked = useSignal<SearchItem | null>(null);

  // Compute search items
  const searchItems = useComputed$(() =>
    input.value ? result.value : recent.value
  );

  // Use focus trap when search is open
  useFocusTrap(modalElement, open);

  // Do stuff when search is opened or closed
  useTask$(({ track }) => {
    track(() => inputElement.value);
    track(() => open.value);
    if (isBrowser && inputElement.value) {
      // Focus input and block background scrolling when search is opened
      if (open.value) {
        inputElement.value.focus();
        document.body.style.overflow = 'hidden';

        // Tracke open search event
        trackEvent('open_search');

        // Otherwise when search is closed, add clicked item to recent and
        // reset state and background scrolling
      } else {
        const item = clicked.value;
        if (item) {
          recent.value = [
            item,
            ...recent.value.filter((i) => i !== item).slice(0, 5),
          ];

          // Track seleact search item event
          trackEvent('select_search_item', {
            input: input.value,
            path: item.path,
          });
        }

        // Reset state and background scrolling
        input.value = '';
        activeIndex.value = 0;
        result.value = [];
        clicked.value = null;
        document.body.style.overflow = '';
      }
    }
  });

  // Close search when location changes
  useTask$(({ track }) => {
    track(() => location.url);
    if (isBrowser) {
      open.value = false;
    }
  });

  // Update search result and active index when input changes
  useTask$(({ track, cleanup }) => {
    const currentInput = track(() => input.value);
    if (isBrowser) {
      // If input is present, query and set search result
      if (currentInput) {
        // Get its current value
        const storageValue = storage.value[currentInput];

        // Set result of index values is present and not expired
        if (storageValue && storageValue.expires >= Date.now()) {
          activeIndex.value = storageValue.result.length ? 0 : -1;
          result.value = storageValue.result;
          loading.value = false;

          // Otherwise query search result from Algolia with a short timeout to
          // reduce unnecessary queries
        } else {
          const timeout = setTimeout(async () => {
            try {
              const algoliaResult = (await (
                await fetch(
                  `https://${
                    import.meta.env.PUBLIC_ALGOLIA_APP_ID
                  }-dsn.algolia.net/1/indexes/${
                    import.meta.env.PUBLIC_ALGOLIA_INDEX_NAME
                  }/query`,
                  {
                    method: 'POST',
                    headers: {
                      'X-Algolia-Application-Id': import.meta.env
                        .PUBLIC_ALGOLIA_APP_ID,
                      'X-Algolia-API-Key': import.meta.env
                        .PUBLIC_ALGOLIA_PUBLIC_API_KEY,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ query: currentInput }),
                  }
                )
              ).json()) as AlgoliaResult;

              // Transform hits of Algolia result to our schema
              let prevItem: SearchItem | undefined;
              const searchResult: SearchItem[] = algoliaResult.hits.map(
                (hit) => {
                  // Create path by removing origin from URL
                  const path = hit.url.replace(
                    import.meta.env.PUBLIC_WEBSITE_URL,
                    ''
                  );

                  // Create search item object
                  const searchItem: SearchItem = {
                    group: `${hit.hierarchy.lvl0}: ${hit.hierarchy.lvl1}`,
                    relation:
                      hit.type === 'lvl2'
                        ? 'page'
                        : prevItem &&
                          prevItem.relation !== 'none' &&
                          prevItem.path.split('#')[0] === path.split('#')[0]
                        ? 'child'
                        : 'none',
                    type: hit.type,
                    page: hit._highlightResult.hierarchy.lvl2.value,
                    text:
                      hit.type === 'content'
                        ? hit._snippetResult!.content.value
                        : hit._highlightResult.hierarchy[hit.type]!.value,
                    path,
                  };

                  // Update previous item variable
                  prevItem = searchItem;

                  // Return search item object
                  return searchItem;
                }
              );

              // Add search result to search storage
              storage.value = {
                ...storage.value,
                [currentInput]: {
                  result: searchResult,
                  expires: Date.now() + 2.592e8, // 3 days
                },
              };

              // Set search result if input has not changed
              if (currentInput === input.value) {
                activeIndex.value = 0;
                result.value = searchResult;
                loading.value = false;
              }

              // Update state in case of an error
            } catch (_) {
              error.value = true;
            }
          }, 300);

          // Set loading to "true"
          loading.value = true;

          // Clear timeout if the input has changed in the meantime
          cleanup(() => clearTimeout(timeout));
        }

        // Otherwise if input is empty, reset state
      } else {
        activeIndex.value = 0;
        result.value = [];
        loading.value = false;
      }
    }
  });

  /**
   * Handles the click on a search item.
   */
  const handleClick = $((item: SearchItem) => {
    if (item.path === location.url.pathname) {
      open.value = false;
    }
    clicked.value = item;
  });

  /**
   * Handles keyboard keydown events.
   */
  const handleKeyDown = $(
    ({ metaKey, key }: QwikKeyboardEvent<HTMLDivElement>) => {
      // Open or close search
      if ((metaKey && key === 'k') || (open.value && key === 'Escape')) {
        open.value = !open.value;
      }

      if (open.value) {
        // Change active index
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          const maxIndex = searchItems.value.length - 1;
          activeIndex.value =
            key === 'ArrowUp'
              ? activeIndex.value === 0
                ? maxIndex
                : activeIndex.value - 1
              : activeIndex.value === maxIndex
              ? 0
              : activeIndex.value + 1;
        }

        // Select current active index
        if (key === 'Enter') {
          const item = searchItems.value[activeIndex.value];
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (item) {
            if (item.path === location.url.pathname) {
              open.value = false;
            } else {
              navigate(item.path);
            }
            clicked.value = item;
          }
        }
      }
    }
  );

  return (
    <div
      class={clsx(
        open.value && 'fixed left-0 top-0 z-40 h-screen w-screen lg:p-48'
      )}
      ref={modalElement}
      window:onKeyDown$={handleKeyDown}
    >
      {open.value && (
        <>
          <div class="flex h-full w-full flex-col bg-white/90 backdrop-blur-sm dark:bg-gray-900/90 lg:mx-auto lg:h-auto lg:max-h-full lg:max-w-3xl lg:rounded-3xl lg:bg-white lg:backdrop-blur-none lg:dark:bg-gray-900">
            {/* Header */}
            <header class="flex h-14 flex-shrink-0 items-center px-2 md:h-16 lg:h-[72px] lg:px-4">
              <form class="flex flex-1" preventdefault:submit>
                <SystemIcon
                  label={loading.value ? 'Search' : 'Focus search input'}
                  type="button"
                  onClick$={() => inputElement.value!.focus()}
                  loading={loading.value}
                >
                  <SearchIcon class="h-full" />
                </SystemIcon>
                <input
                  class="flex-1 bg-transparent px-2 text-lg text-slate-900 outline-none placeholder:text-slate-500 dark:text-slate-200 md:text-xl"
                  ref={inputElement}
                  type="search"
                  placeholder="Search docs"
                  value={input.value}
                  onInput$={(_, element) => (input.value = element.value)}
                />
              </form>
              <SystemIcon
                class="lg:!h-[22px] lg:!w-[22px]"
                label="Close search"
                type="button"
                onClick$={() => (open.value = false)}
              >
                <CloseIcon class="h-full" />
              </SystemIcon>
            </header>

            {/* Content */}
            <div class="flex-1 overflow-y-auto overscroll-contain scroll-smooth p-4 lg:min-h-[120px] lg:px-6">
              {
                // Error
                error.value ? (
                  <p class="md:text-lg">
                    An unexpected error has occurred. If this happens regularly,
                    please create an{' '}
                    <TextLink
                      href={`${import.meta.env.VITE_GITHUB_URL}/issues/new`}
                      target="_blank"
                      colored
                      underlined
                    >
                      issue
                    </TextLink>{' '}
                    on Github.
                  </p>
                ) : // No result
                input.value && !loading.value && !result.value.length ? (
                  <p class="text-sm md:text-base">
                    No results for "
                    <span class="text-slate-900 dark:text-slate-200">
                      {input.value}
                    </span>
                    "
                  </p>
                ) : // Result
                input.value && result.value.length ? (
                  <ul>
                    {result.value.map((item, index) => {
                      const getPrevItem = () =>
                        index > 0 ? result.value[index - 1] : undefined;
                      const getGroup = () =>
                        getPrevItem()?.group !== item.group
                          ? item.group
                          : undefined;
                      return (
                        <li
                          key={item.path}
                          class={clsx(
                            index > 0 &&
                              (getGroup()
                                ? 'mt-9'
                                : item.relation === 'page' &&
                                  getPrevItem()?.relation !== 'page'
                                ? 'mt-6'
                                : item.relation === 'child'
                                ? 'border-l-2 border-l-slate-200 pl-2 pt-2.5 dark:border-l-slate-800'
                                : 'mt-2.5')
                          )}
                        >
                          {getGroup() && (
                            <div class="mb-6 text-sm md:text-base">
                              {getGroup()}
                            </div>
                          )}
                          <SearchItem
                            {...item}
                            index={index}
                            activeIndex={activeIndex}
                            onClick$={() => handleClick(item)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                ) : // Resent
                recent.value!.length ? (
                  <>
                    <div class="text-sm md:text-base">Recent</div>
                    <ul class="mt-6 space-y-2.5">
                      {recent.value.map((item, index) => (
                        <li key={item.path}>
                          <SearchItem
                            {...item}
                            index={index}
                            activeIndex={activeIndex}
                            onClick$={() => handleClick(item)}
                            recent
                          />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null
              }
            </div>

            {/* Footer */}
            <footer class="flex h-12 flex-shrink-0 items-center justify-end px-4 text-xs md:h-14 md:text-sm lg:h-[72px] lg:px-6">
              Search by
              <TextLink
                class="ml-3 md:ml-4"
                href="https://www.algolia.com/ref/docsearch/?utm_source=valibot.dev&utm_medium=referral&utm_content=powered_by&utm_campaign=docsearch"
                target="_blank"
              >
                <svg
                  class="h-[18px] md:h-5"
                  viewBox="0 0 85 20"
                  role="img"
                  aria-label="Algolia logo"
                  fill="#003dff"
                  fill-rule="evenodd"
                >
                  <path d="M41.43 10.97V.62a.23.23 0 0 0-.26-.23l-1.94.3a.23.23 0 0 0-.2.23l.01 10.5a3.43 3.43 0 0 0 3.7 3.67.23.23 0 0 0 .23-.22V13.3a.23.23 0 0 0-.2-.22c-1.34-.16-1.34-1.83-1.34-2.1Z" />
                  <path d="M71.47 4.42h1.95a.23.23 0 0 1 .23.22v10.23a.23.23 0 0 1-.23.23h-1.95a.23.23 0 0 1-.23-.23V4.64a.23.23 0 0 1 .23-.22Z" />
                  <path d="M71.47 3.13h1.95a.23.23 0 0 0 .23-.22V.6a.23.23 0 0 0-.25-.2l-1.95.3a.23.23 0 0 0-.2.23v1.99a.23.23 0 0 0 .23.22Zm-3.37 7.84V.62a.23.23 0 0 0-.26-.23L65.9.7a.23.23 0 0 0-.2.23l.01 10.5a3.43 3.43 0 0 0 3.69 3.67.23.23 0 0 0 .23-.22V13.3a.23.23 0 0 0-.2-.22c-1.33-.16-1.33-1.83-1.33-2.1Zm-5.08-5.09a4.36 4.36 0 0 0-1.57-1.1 5.22 5.22 0 0 0-2-.37 5.07 5.07 0 0 0-2 .38 4.59 4.59 0 0 0-1.56 1.09 4.97 4.97 0 0 0-1.03 1.69 6.52 6.52 0 0 0-.36 2.24 5.67 5.67 0 0 0 .37 2.09 5.05 5.05 0 0 0 1.02 1.7 4.56 4.56 0 0 0 1.56 1.1 6.25 6.25 0 0 0 2.01.4 6.37 6.37 0 0 0 2.03-.4 4.46 4.46 0 0 0 1.56-1.1 4.94 4.94 0 0 0 1.01-1.7 5.79 5.79 0 0 0 .36-2.09 6.25 6.25 0 0 0-.39-2.24 5.05 5.05 0 0 0-1.01-1.7Zm-1.7 6.29a2.33 2.33 0 0 1-3.7 0 3.73 3.73 0 0 1-.67-2.35 4.2 4.2 0 0 1 .66-2.5 2.34 2.34 0 0 1 3.7 0 4.2 4.2 0 0 1 .66 2.5 3.75 3.75 0 0 1-.66 2.35ZM34.67 4.42h-1.9a5.29 5.29 0 0 0-4.45 2.46 5.6 5.6 0 0 0 1.1 7.3 3.2 3.2 0 0 0 .36.27 3.1 3.1 0 0 0 1.71.52h.32l.1-.02h.03a3.47 3.47 0 0 0 2.72-2.41v2.22a.23.23 0 0 0 .23.23h1.94a.23.23 0 0 0 .22-.23V4.66a.23.23 0 0 0-.22-.23Zm0 7.95a2.93 2.93 0 0 1-1.72.58h-.15a3.03 3.03 0 0 1-2.97-3.05 3.09 3.09 0 0 1 .21-1.11 2.94 2.94 0 0 1 2.73-1.92h1.9Zm47.65-7.95h-1.9a5.29 5.29 0 0 0-4.45 2.46 5.6 5.6 0 0 0 1.1 7.3 3.22 3.22 0 0 0 .36.27 3.1 3.1 0 0 0 1.7.52h.33l.1-.02h.02a3.47 3.47 0 0 0 2.73-2.41v2.22a.23.23 0 0 0 .22.23h1.94a.23.23 0 0 0 .23-.23V4.66a.23.23 0 0 0-.23-.23Zm0 7.95a2.93 2.93 0 0 1-1.73.58h-.14a3.03 3.03 0 0 1-2.97-3.05 3.09 3.09 0 0 1 .21-1.11 2.94 2.94 0 0 1 2.73-1.92h1.9ZM50.8 4.42h-1.9a5.29 5.29 0 0 0-4.45 2.46 5.56 5.56 0 0 0-.85 2.4 5.71 5.71 0 0 0 0 1.26 5.53 5.53 0 0 0 1.95 3.64 3.2 3.2 0 0 0 .36.27 3.1 3.1 0 0 0 1.7.52 3.1 3.1 0 0 0 1.86-.62 3.48 3.48 0 0 0 1.32-1.83v2.36a2.5 2.5 0 0 1-.66 1.9 3.2 3.2 0 0 1-2.24.64c-.43 0-1.1-.03-1.8-.1a.23.23 0 0 0-.23.17l-.5 1.65a.23.23 0 0 0 .2.3 16.72 16.72 0 0 0 2.1.17 6.08 6.08 0 0 0 4.18-1.24 4.7 4.7 0 0 0 1.35-3.4V4.64a.23.23 0 0 0-.23-.23H50.8Zm0 2.46s.03 5.35 0 5.51a2.89 2.89 0 0 1-1.67.57h-.3a3.06 3.06 0 0 1-2.66-4.17 2.94 2.94 0 0 1 2.74-1.91h1.9Z" />
                  <path d="M9.9.39a9.6 9.6 0 1 0 4.56 18.05.23.23 0 0 0 .04-.36l-.9-.8a.64.64 0 0 0-.66-.12A7.8 7.8 0 1 1 9.9 2.2h7.79v13.85l-4.42-3.93a.33.33 0 0 0-.48.05 3.62 3.62 0 1 1 .72-2.5.65.65 0 0 0 .2.43l1.16 1.02a.23.23 0 0 0 .37-.13 5.45 5.45 0 1 0-2.15 3.4l5.77 5.12a.38.38 0 0 0 .64-.29V.75a.36.36 0 0 0-.37-.36Z" />
                </svg>
              </TextLink>
            </footer>
          </div>
          <div
            class="hidden lg:absolute lg:left-0 lg:top-0 lg:-z-10 lg:block lg:h-full lg:w-full lg:cursor-default lg:bg-gray-200/50 lg:backdrop-blur-sm lg:dark:bg-gray-800/50"
            role="button"
            onClick$={() => (open.value = false)}
          />
        </>
      )}
    </div>
  );
});

type SearchItemProps = SearchItem & {
  index: number;
  activeIndex: Signal<number>;
  onClick$: () => void;
  recent?: boolean;
};

/**
 * Displays relevant info of a single search result and links to its page.
 */
const SearchItem = component$<SearchItemProps>(
  ({
    type,
    relation,
    page,
    text,
    path,
    index,
    activeIndex,
    onClick$,
    recent,
  }) => {
    // Use element signal
    const element = useSignal<HTMLAnchorElement>();

    // Compute active state
    const active = useComputed$(() => index === activeIndex.value);

    // Scroll element into view if active
    useTask$(({ track }) => {
      track(() => element.value);
      track(() => active.value);
      if (isBrowser && element.value && active.value) {
        element.value.scrollIntoView({ block: 'nearest' });
      }
    });

    return (
      <Link
        class={clsx(
          'focus-ring flex scroll-my-12 items-center rounded-2xl border-2 px-5 py-4 md:px-6',
          active.value
            ? 'border-transparent bg-sky-600/10 text-sky-600 dark:bg-sky-400/10 dark:text-sky-400'
            : 'border-slate-200 dark:border-slate-800'
        )}
        ref={element}
        href={path}
        onMouseEnter$={() => (activeIndex.value = index)}
        onFocusin$={() => (activeIndex.value = index)}
        onClick$={onClick$}
      >
        {relation === 'page' ? (
          <PageIcon class="h-5 flex-shrink-0 md:h-6" />
        ) : (
          <HashtagIcon class="h-5 flex-shrink-0 md:h-6" />
        )}
        <div
          class={clsx(
            'flex-1 px-4 md:px-5 [&_mark]:bg-transparent [&_mark]:font-medium',
            active.value
              ? '[&_mark]:text-sky-600 [&_mark]:underline [&_mark]:dark:text-sky-400'
              : '[&_mark]:text-slate-900 [&_mark]:dark:text-slate-200'
          )}
        >
          {type === 'content' && (relation === 'none' || recent) && (
            <div
              class="mb-2 text-xs md:text-sm"
              dangerouslySetInnerHTML={page}
            />
          )}
          <div
            class="text-sm md:text-base"
            dangerouslySetInnerHTML={`${
              type !== 'lvl2' &&
              type !== 'content' &&
              (relation === 'none' || recent)
                ? `${page}: `
                : ''
            }${text}`}
          />
        </div>
        <AngleRightIcon class="h-3 flex-shrink-0 md:h-4" />
      </Link>
    );
  }
);
