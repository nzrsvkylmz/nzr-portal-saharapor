"use client";

/**
 * Kullanıcı kartındaki formu silme action'ıyla gönderen buton;
 * göndermeden önce tarayıcı onayı ister.
 */
export function DeleteButton({
  action,
  nick,
}: {
  action: (formData: FormData) => Promise<void>;
  nick: string;
}) {
  return (
    <button
      type="submit"
      formAction={action}
      formNoValidate
      onClick={(e) => {
        if (!window.confirm(`"${nick}" kalıcı olarak silinecek. Emin misiniz?`)) {
          e.preventDefault();
        }
      }}
      className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
    >
      Sil
    </button>
  );
}
