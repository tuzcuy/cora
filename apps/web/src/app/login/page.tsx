import { LoginForm } from '@/components/login-form';

export default function LoginPage() {
  return (
    <main className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent font-bold">C</div>
          <span className="text-xl font-semibold tracking-tight">Cora</span>
        </div>
        <div className="space-y-4">
          <h1 className="text-3xl font-semibold leading-tight">
            Teklif → Sipariş → Depo → Sevkiyat
            <br />
            tek ekranda.
          </h1>
          <p className="max-w-md text-sm text-primary-foreground/70">
            Toptancılar için hızlı ürün bulma, kolay teklif/sipariş, siparişin nerede olduğunu görme
            ve kâr takibi.
          </p>
        </div>
        <p className="text-xs text-primary-foreground/50">
          © {new Date().getFullYear()} Corant Soft
        </p>
      </div>

      {/* Form panel */}
      <div className="grid place-items-center p-6">
        <LoginForm />
      </div>
    </main>
  );
}
