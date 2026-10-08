export class RemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemoteError";
  }
}

export class LoginRequired extends RemoteError {
  constructor() {
    super("Nezir Sistem oturumu yok veya sona erdi. Tekrar giriş yapın.");
    this.name = "LoginRequired";
  }
}

export class VerifyRequired extends RemoteError {
  constructor() {
    super("Nezir Sistem doğrulama kodu (OTP) bekliyor.");
    this.name = "VerifyRequired";
  }
}
