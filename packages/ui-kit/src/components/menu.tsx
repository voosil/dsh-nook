import { Menu as BaseMenu } from '@base-ui-components/react/menu'
import { Fragment, useContext, useMemo } from 'react'
import { PortalContainerContext } from './portal.js'

export type MenuItemDef = { label: string; run?: () => void; danger?: boolean; disabled?: boolean }
export type MenuAnchor = { x: number; y: number }

export function Menu({
  anchor,
  items,
  open,
  onOpenChange,
  container,
}: {
  anchor: MenuAnchor
  items: readonly MenuItemDef[]
  open: boolean
  onOpenChange: (open: boolean) => void
  container?: HTMLElement | null
}) {
  const virtual = useMemo(
    () => ({
      getBoundingClientRect: () => new DOMRect(anchor.x, anchor.y, 0, 0),
    }),
    [anchor.x, anchor.y],
  )
  const inheritedContainer = useContext(PortalContainerContext)
  const portalTarget = container ?? inheritedContainer
  return (
    <BaseMenu.Root open={open} onOpenChange={onOpenChange}>
      <BaseMenu.Portal {...(portalTarget === null ? {} : { container: portalTarget })}>
        <BaseMenu.Positioner
          anchor={virtual}
          side="bottom"
          align="start"
          sideOffset={2}
          arrowPadding={0}
          positionMethod="fixed"
          collisionPadding={8}
          className="nui-menu-positioner"
        >
          <BaseMenu.Popup className="nui-menu">
            {items.map((item, index) => (
              <Fragment key={item.label}>
                {item.danger && index > 0 && !items[index - 1]?.danger ? (
                  <BaseMenu.Separator className="nui-menu-separator" />
                ) : null}
                <BaseMenu.Item
                  key={item.label}
                  {...(item.disabled ? { disabled: true } : {})}
                  className={item.danger ? 'nui-menu-item nui-menu-item--danger' : 'nui-menu-item'}
                  onClick={() => item.run?.()}
                >
                  {item.label}
                </BaseMenu.Item>
              </Fragment>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}
