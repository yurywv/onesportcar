import { describe, it, expect } from "vitest";
import { isValidCPF, isValidCNPJ, isValidPlate, normalizePlate, isValidVIN, isValidRenavam, formatDocument } from "@/lib/validators";
import { parseMoney, money } from "@/lib/format";
import { discountLimit, can } from "@/lib/rbac";

describe("validadores brasileiros", () => {
  it("CPF", () => {
    expect(isValidCPF("529.982.247-25")).toBe(true);
    expect(isValidCPF("529.982.247-24")).toBe(false);
    expect(isValidCPF("111.111.111-11")).toBe(false);
  });
  it("CNPJ numérico e alfanumérico (IN RFB 2.229/2024)", () => {
    expect(isValidCNPJ("11.222.333/0001-81")).toBe(true);
    expect(isValidCNPJ("11.222.333/0001-80")).toBe(false);
    expect(isValidCNPJ("12.ABC.345/01DE-35")).toBe(true);
    expect(isValidCNPJ("12.ABC.345/01DE-36")).toBe(false);
    expect(formatDocument("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
  });
  it("placa antiga e Mercosul", () => {
    expect(isValidPlate("abc-1234")).toBe(true);
    expect(isValidPlate("BRA2E19")).toBe(true);
    expect(isValidPlate("BR2E19")).toBe(false);
    expect(normalizePlate("bra-2e19")).toBe("BRA2E19");
  });
  it("VIN e RENAVAM", () => {
    expect(isValidVIN("WP0ZZZ99ZTS392124")).toBe(true);
    expect(isValidVIN("WP0ZZZ99ZTS39212O")).toBe(false);
    expect(isValidRenavam("00639884962")).toBe(true);
    expect(isValidRenavam("00639884963")).toBe(false);
  });
  it("dinheiro em centavos", () => {
    expect(parseMoney("1.234,56")).toBe(123456);
    expect(parseMoney("99.9")).toBe(9990);
    expect(money(123456).replace(/\s/g, " ")).toContain("1.234,56");
  });
  it("RBAC e limites de desconto", () => {
    expect(can("TECNICO", "orcamento:editar")).toBe(false);
    expect(can("TECNICO", "os:executar")).toBe(true);
    expect(can("AUDITOR", "os:transicionar")).toBe(false);
    expect(discountLimit("CONSULTOR")).toBe(5);
    expect(discountLimit("GESTOR")).toBe(15);
    expect(discountLimit("TECNICO")).toBe(0);
  });
});
