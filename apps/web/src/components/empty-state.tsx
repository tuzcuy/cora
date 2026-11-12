import { Card, CardContent } from '@/components/ui/card';

export function ComingSoon({ title, description }: { title: string; description?: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <Card>
        <CardContent className="grid place-items-center gap-2 py-20 text-center">
          <div className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            Yakında
          </div>
          <p className="max-w-md text-sm text-muted-foreground">
            {description ?? 'Bu modül sıradaki sürümde gelecek.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
