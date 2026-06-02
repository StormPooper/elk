import type { RouteLocationRaw } from 'vue-router'
import { useMagicSequence } from '~/composables/magickeys'
import { currentUser, getInstanceDomain } from '~/composables/users'

export default defineNuxtPlugin(({ $scrollToTop }) => {
  const keys = useMagicKeys()
  const router = useRouter()
  const i18n = useNuxtApp().$i18n
  const { y } = useWindowScroll({ behavior: 'instant' })

  // disable shortcuts when focused on inputs (https://vueuse.org/core/usemagickeys/#conditionally-disable)
  const activeElement = useActiveElement()

  const notUsingInput = computed(() =>
    activeElement.value?.tagName !== 'INPUT'
    && activeElement.value?.tagName !== 'TEXTAREA'
    && !activeElement.value?.isContentEditable,
  )
  const isAuthenticated = currentUser.value !== undefined

  const navigateTo = (to: string | RouteLocationRaw) => {
    closeKeyboardShortcuts()
    ;($scrollToTop as () => void)() // is this really required?
    router.push(to)
  }

  whenever(logicAnd(notUsingInput, keys['?']), toggleKeyboardShortcuts)

  const defaultPublishDialog = () => {
    const current = keys.current
    // exclusive 'c' - not apply in combination
    // TODO: bugfix -> create PR for vueuse, reset `current` ref on window focus|blur
    if (!current.has('shift') && !current.has('meta') && !current.has('control') && !current.has('alt')) {
      // TODO: is this the correct way of using openPublishDialog()?
      openPublishDialog('dialog', getDefaultDraftItem())
    }
  }
  whenever(logicAnd(isAuthenticated, notUsingInput, keys.c), defaultPublishDialog)

  const instanceDomain = currentInstance.value ? getInstanceDomain(currentInstance.value) : 'm.webtoo.ls'
  whenever(logicAnd(notUsingInput, useMagicSequence(['g', 'h'])), () => navigateTo('/home'))
  whenever(logicAnd(isAuthenticated, notUsingInput, useMagicSequence(['g', 'n'])), () => navigateTo('/notifications'))
  // TODO: always overridden by 'c' (compose) shortcut
  whenever(logicAnd(isAuthenticated, notUsingInput, useMagicSequence(['g', 'c'])), () => navigateTo('/conversations'))
  whenever(logicAnd(isAuthenticated, notUsingInput, useMagicSequence(['g', 'f'])), () => navigateTo('/favourites'))
  whenever(logicAnd(isAuthenticated, notUsingInput, useMagicSequence(['g', 'b'])), () => navigateTo('/bookmarks'))
  whenever(logicAnd(notUsingInput, useMagicSequence(['g', 'e'])), () => navigateTo(`/${instanceDomain}/explore`))
  whenever(logicAnd(notUsingInput, useMagicSequence(['g', 'l'])), () => navigateTo(`/${instanceDomain}/public/local`))
  whenever(logicAnd(notUsingInput, useMagicSequence(['g', 't'])), () => navigateTo(`/${instanceDomain}/public`))
  whenever(logicAnd(isAuthenticated, notUsingInput, useMagicSequence(['g', 'i'])), () => navigateTo('/lists'))
  whenever(logicAnd(notUsingInput, useMagicSequence(['g', 's'])), () => navigateTo('/settings'))
  whenever(logicAnd(isAuthenticated, notUsingInput, useMagicSequence(['g', 'p'])), () => navigateTo(`/${instanceDomain}/@${currentUser.value?.account.username}`))
  whenever(logicAnd(notUsingInput, computed(() => keys.current.size === 1), keys['/']), () => navigateTo('/search'))

  const toggleFavouriteActiveStatus = () => {
    // TODO: find a better solution than clicking buttons...
    document
      .querySelector<HTMLElement>('[aria-roledescription=status-details]')
      ?.querySelector<HTMLElement>(`button[aria-label=${i18n.t('action.favourite')}]`)
      ?.click()
  }
  whenever(logicAnd(isAuthenticated, notUsingInput, keys.f), toggleFavouriteActiveStatus)

  const toggleBoostActiveStatus = () => {
    // TODO: find a better solution than clicking buttons...
    document
      .querySelector<HTMLElement>('[aria-roledescription=status-details]')
      ?.querySelector<HTMLElement>(`button[aria-label=${i18n.t('action.boost')}]`)
      ?.click()
  }
  whenever(logicAnd(isAuthenticated, notUsingInput, keys.b), toggleBoostActiveStatus)

  const composeWithQuote = () => {
    const quotedStatusId = document.querySelector<HTMLElement>('[aria-roledescription=status-details]')
      ?.getAttribute('id')
      ?.replace('status-', '')
    if (quotedStatusId)
      navigateTo(`/compose?quote=${quotedStatusId}`)
  }
  whenever(logicAnd(isAuthenticated, notUsingInput, keys.q), composeWithQuote)

  const statusSelector = '[aria-roledescription="status-card"]'

  function getVisibleTopLevelStatuses(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(statusSelector))
      .filter(c => !c.parentElement?.closest(statusSelector) && c.offsetParent !== null)
  }

  function getTopBarHeight(): number {
    return document.querySelector<HTMLElement>('[data-top-bar]')?.offsetHeight ?? 0
  }

  const showNewItems = () => {
    document
      ?.querySelector<HTMLElement>('button#elk_show_new_items')
      ?.click()
    // Instant scroll then wait one frame for virtua to mount the top cards
    // (smooth scroll would still be mid-animation here)
    y.value = 0
    requestAnimationFrame(() => {
      getVisibleTopLevelStatuses()[0]?.focus({ preventScroll: true })
    })
  }
  whenever(logicAnd(isAuthenticated, notUsingInput, keys['.']), showNewItems)

  function tryGetNextTarget(
    direction: 'next' | 'previous',
    statuses: HTMLElement[],
    topBar: number,
  ): HTMLElement | null {
    const innerActive = activeElement.value?.closest<HTMLElement>(statusSelector) ?? null
    const current = innerActive ? statuses.find(s => s.contains(innerActive)) ?? null : null
    if (!current) {
      const distances = statuses.map(el => Math.abs(el.getBoundingClientRect().top - topBar))
      const nearestToTopBar = distances.reduce((best, d, i) => d < distances[best] ? i : best, 0)
      return statuses[nearestToTopBar]
    }
    const currentIndex = statuses.indexOf(current)
    const nextIndex = direction === 'next'
      ? Math.min(currentIndex + 1, statuses.length - 1)
      : Math.max(0, currentIndex - 1)
    const target = statuses[nextIndex]
    return target === current ? null : target
  }

  function focusAndAlign(target: HTMLElement, topBar: number) {
    target.focus({ preventScroll: true })
    const delta = target.getBoundingClientRect().top - topBar
    if (delta !== 0)
      y.value += delta
  }

  function focusNextOrPreviousStatus(direction: 'next' | 'previous') {
    const statuses = getVisibleTopLevelStatuses()
    if (statuses.length === 0)
      return

    const topBar = getTopBarHeight()
    const target = tryGetNextTarget(direction, statuses, topBar)
    if (target) {
      focusAndAlign(target, topBar)
      return
    }

    const renderedBeforeNudge = new Set(statuses)
    const nudge = window.innerHeight / 2
    y.value += direction === 'next' ? nudge : -nudge
    requestAnimationFrame(() => {
      const after = getVisibleTopLevelStatuses()
      const newCardsMounted = after.some(c => !renderedBeforeNudge.has(c))
      if (!newCardsMounted)
        return
      const retryTopBar = getTopBarHeight()
      const retryTarget = tryGetNextTarget(direction, after, retryTopBar)
      if (retryTarget)
        focusAndAlign(retryTarget, retryTopBar)
    })
  }

  whenever(logicAnd(notUsingInput, keys.j), () => focusNextOrPreviousStatus('next'))
  whenever(logicAnd(notUsingInput, keys.k), () => focusNextOrPreviousStatus('previous'))
})
