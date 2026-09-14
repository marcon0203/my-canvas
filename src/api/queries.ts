import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { submitGen, cancelGen } from './generation';
import { fetchProject, fetchProjectList } from './mock';
import { parseGenParams, type GenParams } from './schemas';

export const qk = {
  projectList: ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  tasks: ['tasks'] as const,
};

/** 首页「最近的项目」列表 */
export function useProjectList() {
  return useQuery({ queryKey: qk.projectList, queryFn: fetchProjectList, staleTime: Infinity });
}

/** 按 ID 拉取项目内容 + 能力配置。id 为空时不发请求 */
export function useProjectData(projectId: string) {
  return useQuery({
    queryKey: qk.project(projectId),
    queryFn: () => fetchProject(projectId),
    enabled: projectId.length > 0,
    staleTime: Infinity,
  });
}

/** 生成任务提交（mutation 语义） */
export function useSubmitGen() {
  return useMutation({
    mutationFn: async (p: GenParams) => {
      const parsed = parseGenParams(p);
      return submitGen(parsed);
    },
  });
}

export function useCancelGen() {
  return useMutation({ mutationFn: async (id: string) => cancelGen(id) });
}

export function useInvalidateProject() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: qk.projectList });
}
