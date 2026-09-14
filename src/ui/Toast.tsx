import { useUi } from '@/store/ui';

/** Toast 宿主：与原型同构，每个 .toast 是独立的 fixed 元素 */
export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <>
      {toasts.map((t) => (
        <div key={t.id} className="toast" role="status">{t.text}</div>
      ))}
    </>
  );
}
