use anchor_lang::prelude::*;

declare_id!("Xxf3vRZE7MbcRgGHYc7baYQuvq6sjYCNmpKzMpKCPep");

#[program]
pub mod moqayada {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
