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

  const showNewItems = () => {
    // TODO: find a better solution than clicking buttons...
    document
      ?.querySelector<HTMLElement>('button#elk_show_new_items')
      ?.click()
    // Reset scroll to the top of the timeline and focus the first card so
    // subsequent j/k continues from the top. Instant scroll so virtua has a
    // stable scroll position when we look up the first card on the next
    // frame — smooth scroll would race with the rAF and we'd focus whichever
    // card happened to be at the top of the rendered set mid-scroll.
    y.value = 0
    requestAnimationFrame(() => {
      const first = Array.from(document.querySelectorAll<HTMLElement>(statusSelector))
        .find(c => !c.parentElement?.closest(statusSelector) && c.offsetParent !== null)
      first?.focus({ preventScroll: true })
    })
  }
  whenever(logicAnd(isAuthenticated, notUsingInput, keys['.']), showNewItems)

  function focusNextOrPreviousStatus(direction: 'next' | 'previous', retried = false) {
    const allCards = Array.from(document.querySelectorAll<HTMLElement>(statusSelector))
    // Top-level only (skip status-cards embedded inside another, e.g.
    // quote-boosts), and visible (offsetParent === null catches display:none,
    // hidden subtrees, detached nodes).
    const statuses = allCards.filter(
      c => !c.parentElement?.closest(statusSelector) && c.offsetParent !== null,
    )
    if (statuses.length === 0)
      return

    const topBarHeight = 58
    const innerActive = activeElement.value?.closest<HTMLElement>(statusSelector) ?? null
    const current = innerActive ? statuses.find(s => s.contains(innerActive)) ?? null : null

    let target: HTMLElement
    if (!current) {
      // No focus on a top-level card. Pick the one closest to where the user
      // is currently looking (closest to topBarHeight) so subsequent presses
      // resume near where they were rather than jumping to the very top.
      target = statuses.reduce((closest, c) =>
        Math.abs(c.getBoundingClientRect().top - topBarHeight)
        < Math.abs(closest.getBoundingClientRect().top - topBarHeight)
          ? c
          : closest,
      )
    }
    else {
      const currentIndex = statuses.indexOf(current)
      const nextIndex = direction === 'next'
        ? Math.min(currentIndex + 1, statuses.length - 1)
        : Math.max(0, currentIndex - 1)
      target = statuses[nextIndex]
    }

    // No top-level card to advance to: nudge the viewport so virtua can extend
    // its buffer (or the paginator's end-anchor can come into view). On the
    // first attempt of a given keypress, schedule one retry on the next frame
    // — but only if virtua actually mounted new top-level cards during the
    // nudge, so a press at the genuine end of the timeline doesn't recurse.
    if (current && target === current) {
      if (retried)
        return
      const before = new Set(statuses)
      const nudge = window.innerHeight / 2
      y.value += direction === 'next' ? nudge : -nudge
      requestAnimationFrame(() => {
        const after = Array.from(document.querySelectorAll<HTMLElement>(statusSelector))
          .filter(c => !c.parentElement?.closest(statusSelector) && c.offsetParent !== null)
        if (after.some(c => !before.has(c)))
          focusNextOrPreviousStatus(direction, true)
      })
      return
    }

    target.focus({ preventScroll: true })
    y.value += target.getBoundingClientRect().top - topBarHeight
  }

  whenever(logicAnd(notUsingInput, keys.j), () => focusNextOrPreviousStatus('next'))
  whenever(logicAnd(notUsingInput, keys.k), () => focusNextOrPreviousStatus('previous'))
})
