import { cn } from '@/lib/cn';

/** 文本输入：原型 .nv-input 同构（弹窗表单用） */
export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn('nv-input', className)} />;
}

/** 多行输入：原型 .runbar__input 同构（本镜内容、手改提示词） */
export function Textarea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn('runbar__input', className)} />;
}
