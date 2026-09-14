import { useMemo } from 'react';
import { Color } from 'three';
import { cssVar } from '@/lib/cssVar';

/** 3D 场景色全部来自 CSS 变量，不硬编码 hex —— 切主题时场景跟着变 */
export function useSceneColors(theme: string) {
  return useMemo(() => {
    const c = (name: string) => new Color(cssVar(name) || '#ffffff');
    return {
      bg: c('--color-scene-bg'),
      floor: c('--color-scene-floor'),
      prop: c('--color-scene-prop'),
      mark: c('--color-scene-mark'),
      label: c('--color-scene-label'),
      gizmoCam: c('--color-gizmo-cam'),
      gizmoLight: c('--color-gizmo-light'),
      model: {
        base: c('--color-model-base'),
        mid: c('--color-model-mid'),
        shade: c('--color-model-shade'),
      },
    };
    // theme 变了要重取
  }, [theme]);
}
