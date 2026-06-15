import { useEffect, useRef, type ReactNode } from "react";
import {
  FixedSizeList,
  VariableSizeList,
  type ListChildComponentProps,
} from "react-window";

/** Surfaces render their existing markup at/below this count and only switch to
 *  VirtualList above it. Chosen above every per-surface count on the 43/44/47 fixtures,
 *  so existing tests + screenshots stay on the unchanged path. */
export const VIRTUALIZE_THRESHOLD = 40;

/** Default inner-scroll viewport height, mirroring LibraryView's `LIST_HEIGHT = 600`. */
const DEFAULT_HEIGHT = 600;

type Common<T> = {
  items: T[];
  /** Inner-scroll viewport height in px. Defaults to 600 (LibraryView precedent). */
  height?: number;
  width?: number | string;
  className?: string;
  overscanCount?: number;
  renderItem: (item: T, index: number) => ReactNode;
};

type Props<T> =
  | (Common<T> & { itemSize: number })
  | (Common<T> & { itemSize: (index: number) => number });

export function VirtualList<T>(props: Props<T>) {
  const {
    items,
    height = DEFAULT_HEIGHT,
    width = "100%",
    className,
    overscanCount = 6,
    renderItem,
  } = props;
  const variable = typeof props.itemSize === "function";
  const varRef = useRef<VariableSizeList>(null);

  // VariableSizeList memoizes measured offsets; reset when the row set changes
  // (e.g. a collapse toggle reorders the flattened rows).
  useEffect(() => {
    if (variable) varRef.current?.resetAfterIndex(0);
  }, [items, variable]);

  const Row = ({ index, style }: ListChildComponentProps) => (
    // The `style` MUST be applied to the row's outer element or layout breaks.
    <div style={style}>{renderItem(items[index], index)}</div>
  );

  if (variable) {
    return (
      <VariableSizeList
        ref={varRef}
        className={className}
        height={height}
        width={width}
        itemCount={items.length}
        itemSize={props.itemSize as (i: number) => number}
        overscanCount={overscanCount}
      >
        {Row}
      </VariableSizeList>
    );
  }
  return (
    <FixedSizeList
      className={className}
      height={height}
      width={width}
      itemCount={items.length}
      itemSize={props.itemSize as number}
      overscanCount={overscanCount}
    >
      {Row}
    </FixedSizeList>
  );
}
