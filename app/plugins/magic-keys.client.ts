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
  const topBarHeight = 58

  function visibleTopLevelStatuses(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(statusSelector))
      .filter(c => !c.parentElement?.closest(statusSelector) && c.offsetParent !== null)
  }

  function distanceFromTopBar(el: HTMLElement) {
    return Math.abs(el.getBoundingClientRect().top - topBarHeight)
  }

  const showNewItems = () => {
    document
      ?.querySelector<HTMLElement>('button#elk_show_new_items')
      ?.click()
    // Instant scroll so virtua has a stable scroll position on the next
    // animation frame. Smooth scroll would still be in flight when we
    // look up the first card.
    y.value = 0
    requestAnimationFrame(() => {
      visibleTopLevelStatuses()[0]?.focus({ preventScroll: true })
    })
  }
  whenever(logicAnd(isAuthenticated, notUsingInput, keys['.']), showNewItems)

  function focusNextOrPreviousStatus(direction: 'next' | 'previous', retried = false) {
    const statuses = visibleTopLevelStatuses()
    if (statuses.length === 0)
      return

    const innerActive = activeElement.value?.closest<HTMLElement>(statusSelector) ?? null
    const current = innerActive ? statuses.find(s => s.contains(innerActive)) ?? null : null

    let target: HTMLElement
    if (!current) {
      const distances = statuses.map(distanceFromTopBar)
      const nearestToTopBar = distances.reduce((best, d, i) => d < distances[best] ? i : best, 0)
      target = statuses[nearestToTopBar]
    }
    else {
      const currentIndex = statuses.indexOf(current)
      const nextIndex = direction === 'next'
        ? Math.min(currentIndex + 1, statuses.length - 1)
        : Math.max(0, currentIndex - 1)
      target = statuses[nextIndex]
    }

    if (current && target === current) {
      if (retried)
        return
      const renderedBeforeNudge = new Set(statuses)
      const nudge = window.innerHeight / 2
      y.value += direction === 'next' ? nudge : -nudge
      requestAnimationFrame(() => {
        const newCardsMounted = visibleTopLevelStatuses().some(c => !renderedBeforeNudge.has(c))
        if (newCardsMounted)
          focusNextOrPreviousStatus(direction, true)
      })
      return
    }

    target.focus({ preventScroll: true })
    const delta = target.getBoundingClientRect().top - topBarHeight
    if (delta !== 0)
      y.value += delta
  }

  whenever(logicAnd(notUsingInput, keys.j), () => focusNextOrPreviousStatus('next'))
  whenever(logicAnd(notUsingInput, keys.k), () => focusNextOrPreviousStatus('previous'))
})
