export interface ITestRPC {
  dbReq(param: number): string;
  dbReq2(param: string): string;
}

export interface ITestRPC2 {
  dbReq(param: number): string;
  dbReq3(param: string, param2: number): string;
}

export type Wrapped = { TestRPC: ITestRPC; TestRPC2: ITestRPC2 };
export interface Unwrapped extends ITestRPC, ITestRPC2 {}
